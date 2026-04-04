// mcp-server/src/index.ts
// HTTP server exposing BSV agent tools as MCP-compatible REST endpoints

import Fastify from 'fastify';
import { logger, agentUrl } from '../../shared/utils';
import axios from 'axios';

const PORT = parseInt(process.env.MCP_SERVER_PORT ?? '3001');
const server = Fastify({ logger: false });

const tools = [
  { name: 'discover_agents',      description: 'Discover available AI agents on the BSV network' },
  { name: 'negotiate_service',    description: 'Initiate a BSV micro-payment negotiation' },
  { name: 'send_payment',         description: 'Send a BSV micro-payment to an agent' },
  { name: 'query_knowledge',      description: 'Query the knowledge agent' },
  { name: 'validate_transaction', description: 'Validate a BSV transaction' },
  { name: 'get_system_metrics',   description: 'Get system-wide metrics' },
  { name: 'get_wallet_balance',   description: 'Get BSV wallet balance for a specific agent' },
  { name: 'orchestrate_task',     description: 'Submit a high-level goal to the orchestrator' },
];

server.get('/',       async () => ({ name: 'agentic-pay-mcp', version: '1.0.0', port: PORT, tools: tools.map(t => t.name) }));
server.get('/health', async () => ({ status: 'ok', port: PORT }));
server.get('/tools',  async () => ({ tools }));

server.post('/tools/discover_agents', async (req: any) => {
  const resp = await axios.get(agentUrl('discovery', '/agents'));
  let agents = resp.data.agents ?? [];
  const { capabilities } = req.body as { capabilities?: string[] };
  if (capabilities?.length) {
    agents = agents.filter((a: any) =>
      capabilities.every((cap: string) => a.capabilities?.includes(cap))
    );
  }
  return { agents, count: agents.length };
});

server.post('/tools/negotiate_service', async (req: any) => {
  const resp = await axios.post(agentUrl('negotiation', '/negotiate'), req.body);
  return resp.data;
});

server.post('/tools/send_payment', async (req: any) => {
  const input = req.body as { toIdentityKey: string; amountSats: number; serviceType: string };
  const resp = await axios.post(agentUrl('payment', '/payment-request'), {
    negotiationId: `mcp-${Date.now()}`,
    fromAgent: 'mcp-client',
    toAgent: input.toIdentityKey,
    amountSats: input.amountSats,
    serviceType: input.serviceType,
  });
  return resp.data;
});

server.post('/tools/query_knowledge', async (req: any) => {
  const resp = await axios.post(agentUrl('knowledge', '/query'), req.body);
  return resp.data;
});

server.post('/tools/validate_transaction', async (req: any) => {
  const input = req.body as any;
  const resp = await axios.post(agentUrl('validator', '/validate'), {
    id: input.txId,
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    amountSatoshis: input.amountSats,
    status: 'pending',
    negotiationId: 'mcp',
    metadata: {},
    timestamp: Date.now(),
  });
  return resp.data;
});

server.post('/tools/get_system_metrics', async () => {
  const [discovery, payment, validator] = await Promise.allSettled([
    axios.get(agentUrl('discovery', '/health')),
    axios.get(agentUrl('payment',   '/health')),
    axios.get(agentUrl('validator', '/health')),
  ]);
  return {
    discovery: discovery.status === 'fulfilled' ? discovery.value.data : null,
    payment:   payment.status   === 'fulfilled' ? payment.value.data   : null,
    validator: validator.status === 'fulfilled' ? validator.value.data : null,
    timestamp: Date.now(),
  };
});

server.post('/tools/get_wallet_balance', async (req: any) => {
  const { agentRole } = req.body as { agentRole: string };
  const resp = await axios.get(agentUrl(agentRole, '/health'));
  return { agentRole, balance: resp.data.balance ?? 0 };
});

server.post('/tools/orchestrate_task', async (req: any) => {
  const resp = await axios.post(agentUrl('orchestrator', '/task'), req.body);
  return resp.data;
});

server.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    logger.error('mcp-server', 'Fatal error', err);
    process.exit(1);
  }
  logger.info('mcp-server', `MCP server running on port ${PORT}`, {
    tools: tools.map((t) => t.name),
  });
});
