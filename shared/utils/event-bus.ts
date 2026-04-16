// shared/utils/event-bus.ts
// Redis pub/sub event bus for agent communication

import { createClient, RedisClientType } from 'redis';
import type { AgentEvent, AgentMessage } from '../types';
import { generateId, logger, timestamp } from './index';
import { REDIS_KEYS } from '../constants';

export class EventBus {
  private pub: RedisClientType;
  private sub: RedisClientType;
  private handlers: Map<string, ((msg: AgentMessage) => Promise<void>)[]> = new Map();

  constructor(redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379') {
    this.pub = createClient({ url: redisUrl }) as RedisClientType;
    this.sub = this.pub.duplicate() as RedisClientType;
  }

  async connect(): Promise<void> {
    await this.pub.connect();
    await this.sub.connect();
    (global as any).__agentRedis = this.pub; // expose for wallet chain-state persistence
    logger.info('event-bus', 'Redis connected');
  }

  async publish(channel: string, message: AgentMessage): Promise<void> {
    await this.pub.publish(channel, JSON.stringify(message));
    // Also append to stream for UI
    await this.pub.xAdd(REDIS_KEYS.EVENTS, '*', {
      type: message.type,
      from: message.fromAgent,
      to: message.toAgent,
      payload: JSON.stringify(message.payload),
      ts: String(message.timestamp),
    });
  }

  async subscribe(channel: string, handler: (msg: AgentMessage) => Promise<void>): Promise<void> {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, []);
      await this.sub.subscribe(channel, async (raw) => {
        try {
          const msg = JSON.parse(raw) as AgentMessage;
          const fns = this.handlers.get(channel) ?? [];
          await Promise.all(fns.map((fn) => fn(msg)));
        } catch (e) {
          logger.error('event-bus', 'Handler error', e);
        }
      });
    }
    this.handlers.get(channel)!.push(handler);
  }

  async emitAgentEvent(event: Omit<AgentEvent, 'id' | 'timestamp'>): Promise<void> {
    const full: AgentEvent = { ...event, id: generateId(), timestamp: timestamp() };
    await this.pub.lPush('ui:events', JSON.stringify(full));
    await this.pub.lTrim('ui:events', 0, 999); // Keep last 1000
  }

  async incrementTxCount(): Promise<void> {
    await this.pub.incr(REDIS_KEYS.TX_COUNT);
    const key24h = `${REDIS_KEYS.TX_COUNT_24H}:${new Date().toISOString().slice(0, 13)}`;
    await this.pub.incr(key24h);
    await this.pub.expire(key24h, 86400);
  }

  async getTxCount24h(): Promise<number> {
    let total = 0;
    const now = Date.now();
    for (let i = 0; i < 24; i++) {
      const hour = new Date(now - i * 3600000).toISOString().slice(0, 13);
      const val = await this.pub.get(`${REDIS_KEYS.TX_COUNT_24H}:${hour}`);
      total += parseInt(val ?? '0');
    }
    return total;
  }

  async disconnect(): Promise<void> {
    await this.pub.disconnect();
    await this.sub.disconnect();
  }
}

export const createEventBus = (): EventBus => new EventBus();
