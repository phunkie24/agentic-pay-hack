// agents/discovery/src/index.ts
// Pattern: Exploration & Discovery (Ch.21) + A2A Inter-agent comms (Ch.15)
// Agents discover each other via BRC-100 identity — no hardcoding

import Fastify from 'fastify';
import { EventBus, createEventBus } from '../../../shared/utils/event-bus';
import { AgentWallet } from '../../../shared/utils/wallet-manager';
import { think } from '../../../shared/utils/llm-client';
import { generateId, logger, sleep, timestamp, retry, agentUrl } from '../../../shared/utils';
import type { AgentIdentity, AgentMessage, AgentRole } from '../../../shared/types';
import { AGENT_PORTS, AGENT_CAPABILITIES, MESSAGE_TYPES } from '../../../shared/constants';
import axios from 'axios';

const ROLE: AgentRole = 'discovery';
const PORT = AGENT_PORTS[ROLE];

const SYSTEM_PROMPT = `You are the Discovery Agent. Your job is to find other AI agents on the BSV network,
evaluate their capabilities, and determine which ones are suitable for collaboration.
Use BRC-100 identity keys to authenticate discovered agents. 
Prioritize agents with relevant capabilities and fair pricing models.`;

class DiscoveryAgent {
  private wallet: AgentWallet;
  private bus: EventBus;
  private discoveredAgents: Map<string, AgentIdentity> = new Map();
  private server = Fastify({ logger: false });

  constructor() {
    this.wallet = new AgentWallet(ROLE);
    this.bus = createEventBus();
  }

  async start(): Promise<void> {
    await this.wallet.init();
    await this.bus.connect();
    this.setupRoutes();
    await this.server.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(ROLE, `Discovery agent running on port ${PORT}`);

    // Subscribe to discovery messages
    await this.bus.subscribe(`agent:${ROLE}`, this.handleMessage.bind(this));

    // Bootstrap: register our own identity, then broadcast
    await this.registerSelfIdentity();
    this.discoveryLoop();
  }

  private setupRoutes(): void {
    this.server.get('/health', async () => ({
      status: 'ok',
      role: ROLE,
      identityKey: this.wallet.identityKey,
      discoveredCount: this.discoveredAgents.size,
    }));

    this.server.get('/agents', async () => ({
      agents: Array.from(this.discoveredAgents.values()),
    }));

    this.server.post('/execute', async (req: any) => {
      const agents = await this.discoverAgents();
      return { discovered: agents.length, agents };
    });

    // Respond to peer discovery pings
    this.server.post('/discover', async (req: any) => {
      const { fromIdentityKey } = req.body as { fromIdentityKey: string };
      await this.respondToDiscovery(fromIdentityKey);
      return {
        identityKey: this.wallet.identityKey,
        role: ROLE,
        capabilities: AGENT_CAPABILITIES[ROLE],
        endpoint: agentUrl(ROLE),
        pricing: { basePrice: 1, currency: 'BSV', unit: 'per-lookup' },
      };
    });
  }

  // ── BRC-100 Self Registration ──
  private async registerSelfIdentity(): Promise<void> {
    const identity: AgentIdentity = {
      role: ROLE,
      identityKey: this.wallet.identityKey,
      walletAddress: this.wallet.identityKey,
      capabilities: [...AGENT_CAPABILITIES[ROLE]],
      serviceEndpoint: agentUrl(ROLE),
      pricingModel: { basePrice: 1, currency: 'BSV', unit: 'per-lookup' },
    };

    // Store in Redis so other agents can find us
    await (this.bus as any).pub?.hSet(
      'registry:agents',
      this.wallet.identityKey,
      JSON.stringify(identity)
    );

    this.discoveredAgents.set(this.wallet.identityKey, identity);
    logger.info(ROLE, 'Self registered', { identityKey: this.wallet.identityKey });
  }

  // ── Exploration & Discovery (Ch.21) ──
  private async discoverAgents(): Promise<AgentIdentity[]> {
    const peerRoles: AgentRole[] = ['orchestrator', 'negotiation', 'payment', 'knowledge', 'validator'];
    const discovered: AgentIdentity[] = [];

    // Parallel discovery across known agent roles via env-resolved URLs
    const results = await Promise.allSettled(
      peerRoles.map((role) => this.pingAgent(role))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const identity = result.value;
        this.discoveredAgents.set(identity.identityKey, identity);
        discovered.push(identity);

        await this.bus.emitAgentEvent({
          agentRole: ROLE,
          eventType: 'AGENT_DISCOVERED',
          summary: `Discovered ${identity.role} agent`,
          data: { identityKey: identity.identityKey, capabilities: identity.capabilities },
        });
      }
    }

    // Use LLM to evaluate discovered agents (Ch.21 - iterative exploration)
    if (discovered.length > 0) {
      await this.evaluateDiscoveredAgents(discovered);
    }

    logger.info(ROLE, `Discovery complete`, { count: discovered.length });
    return discovered;
  }

  private async pingAgent(role: AgentRole): Promise<AgentIdentity | null> {
    try {
      const endpoint = agentUrl(role);
      const resp = await retry(
        () => axios.post(`${endpoint}/discover`,
          { fromIdentityKey: this.wallet.identityKey },
          { timeout: 5000 }
        ),
        2, 500
      );

      return {
        role: resp.data.role,
        identityKey: resp.data.identityKey,
        walletAddress: resp.data.identityKey,
        capabilities: resp.data.capabilities ?? [],
        serviceEndpoint: endpoint,
        pricingModel: resp.data.pricing ?? { basePrice: 10, currency: 'BSV', unit: 'per-request' },
      };
    } catch {
      return null;
    }
  }

  // ── LLM-based capability evaluation (Ch.21) ──
  private async evaluateDiscoveredAgents(agents: AgentIdentity[]): Promise<void> {
    const summary = agents.map(
      (a) => `${a.role}: ${a.capabilities.join(', ')} @ ${a.pricingModel.basePrice} sats`
    ).join('\n');

    const evaluation = await think(
      ROLE,
      [{
        role: 'user',
        content: `Evaluate these discovered agents for our data exchange workflow:\n${summary}\n
        Which agents should we prioritize for negotiation? Rate their suitability.`,
      }],
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 512 }
    );

    await this.bus.emitAgentEvent({
      agentRole: ROLE,
      eventType: 'AGENTS_EVALUATED',
      summary: 'Evaluated discovered agent capabilities',
      data: { evaluation, agentCount: agents.length },
    });
  }

  private async respondToDiscovery(fromIdentityKey: string): Promise<void> {
    const msg: AgentMessage = {
      id: generateId(),
      type: 'DISCOVER_RESPONSE',
      fromAgent: this.wallet.identityKey,
      toAgent: fromIdentityKey,
      payload: {
        role: ROLE,
        capabilities: AGENT_CAPABILITIES[ROLE],
        endpoint: agentUrl(ROLE),
      },
      timestamp: timestamp(),
    };

    await this.bus.publish(`agent:discovery:response:${fromIdentityKey}`, msg);
  }

  private async handleMessage(msg: AgentMessage): Promise<void> {
    if (msg.type === 'DISCOVER') {
      await this.respondToDiscovery(msg.fromAgent);
    }
  }

  private discoveryLoop(): void {
    // Continuously discover new agents every 30 seconds
    setInterval(async () => {
      try {
        await this.discoverAgents();
      } catch (err) {
        logger.error(ROLE, 'Discovery loop error', err);
      }
    }, 30_000);

    // Initial discovery
    setTimeout(() => this.discoverAgents(), 2000);
  }
}

const agent = new DiscoveryAgent();
agent.start().catch((err) => {
  logger.error(ROLE, 'Fatal error', err);
  process.exit(1);
});
