// ui/src/server/api.ts
// Fastify backend: REST API + WebSocket for real-time UI updates

import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { createClient } from 'redis';
import axios from 'axios';
import { AGENT_PORTS, PAYMENT } from '../../../shared/constants';
import { logger } from '../../../shared/utils';

const API_PORT = parseInt(process.env.API_PORT ?? '3000');
const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });

// In Docker each agent is reachable by its compose service name
const AGENT_HOSTS: Record<string, string> = {
  orchestrator: process.env.ORCHESTRATOR_HOST ?? 'orchestrator',
  discovery:    process.env.DISCOVERY_HOST    ?? 'discovery',
  negotiation:  process.env.NEGOTIATION_HOST  ?? 'negotiation',
  payment:      process.env.PAYMENT_HOST      ?? 'payment',
  knowledge:    process.env.KNOWLEDGE_HOST    ?? 'knowledge',
  validator:    process.env.VALIDATOR_HOST    ?? 'validator',
};

const agentUrl = (role: string, path = '') =>
  `http://${AGENT_HOSTS[role]}:${AGENT_PORTS[role as keyof typeof AGENT_PORTS]}${path}`;

const fastify = Fastify({ logger: false });

async function start(): Promise<void> {
  await redis.connect();
  await fastify.register(fastifyCors, { origin: true });
  await fastify.register(fastifyWebsocket);

  // ── REST endpoints ──
  fastify.get('/api/health', async () => ({ status: 'ok', ts: Date.now() }));

  fastify.get('/api/agents', async () => {
    const roles = Object.keys(AGENT_PORTS);
    const results = await Promise.allSettled(
      roles.map(async (role) => {
        const resp = await axios.get(agentUrl(role, '/health'), { timeout: 2000 });
        return { role, status: 'online', ...resp.data };
      })
    );
    return {
      agents: results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { role: roles[i], status: 'offline' }
      ),
    };
  });

  fastify.get('/api/transactions', async () => {
    const resp = await axios.get(agentUrl('payment', '/transactions')).catch(() => ({ data: { transactions: [] } }));
    return resp.data;
  });

  fastify.get('/api/metrics', async () => {
    const txTotal = await redis.get('metrics:tx_count');
    const now = Date.now();
    let tx24h = 0;
    for (let i = 0; i < 24; i++) {
      const hour = new Date(now - i * 3600000).toISOString().slice(0, 13);
      const val = await redis.get(`metrics:tx_count_24h:${hour}`);
      tx24h += parseInt(val ?? '0');
    }

    const validatorResp = await axios.get(agentUrl('validator', '/validation-log')).catch(() => ({ data: {} }));

    return {
      totalTransactions: parseInt(txTotal ?? '0'),
      transactions24h: tx24h,
      targetTx24h: PAYMENT.TARGET_TX_24H,
      progressPct: Math.min(100, (tx24h / PAYMENT.TARGET_TX_24H) * 100).toFixed(1),
      passRate: validatorResp.data.passRate ?? 100,
      timestamp: Date.now(),
    };
  });

  fastify.get('/api/events', async () => {
    const raw = await redis.lRange('ui:events', 0, 99);
    return { events: raw.map((e) => JSON.parse(e)).reverse() };
  });

  fastify.get('/api/hitl-queue', async () => {
    const resp = await axios.get(agentUrl('validator', '/hitl/queue')).catch(() => ({ data: { queue: [] } }));
    return resp.data;
  });

  fastify.post<{ Body: { txId: string; approved: boolean; reason: string } }>(
    '/api/hitl/review',
    async (req) => {
      const resp = await axios.post(agentUrl('validator', '/hitl/review'), req.body);
      return resp.data;
    }
  );

  // ── WebSocket: Real-time event stream ──
  fastify.get('/ws', { websocket: true }, (socket) => {
    logger.info('api', 'WebSocket client connected');

    const interval = setInterval(async () => {
      try {
        const raw = await redis.lRange('ui:events', 0, 9);
        const events = raw.map((e) => JSON.parse(e));

        const txTotal = await redis.get('metrics:tx_count');
        const now = Date.now();
        let tx24h = 0;
        for (let i = 0; i < 3; i++) {
          const hour = new Date(now - i * 3600000).toISOString().slice(0, 13);
          const val = await redis.get(`metrics:tx_count_24h:${hour}`);
          tx24h += parseInt(val ?? '0');
        }

        if (socket.readyState === 1) {
          socket.send(JSON.stringify({
            type: 'update',
            events,
            metrics: {
              txTotal: parseInt(txTotal ?? '0'),
              tx24h,
              progressPct: Math.min(100, (tx24h / PAYMENT.TARGET_TX_24H) * 100).toFixed(1),
            },
            ts: Date.now(),
          }));
        }
      } catch (err) {
        logger.error('api', 'WebSocket send error', err);
      }
    }, 1000);

    socket.on('close', () => {
      clearInterval(interval);
      logger.info('api', 'WebSocket client disconnected');
    });
  });

  await fastify.listen({ port: API_PORT, host: '0.0.0.0' });
  logger.info('api', `API server running on port ${API_PORT}`);
}

start().catch((err) => {
  logger.error('api', 'Fatal error', err);
  process.exit(1);
});
