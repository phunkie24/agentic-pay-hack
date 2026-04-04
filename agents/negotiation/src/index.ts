// agents/negotiation/src/index.ts
// Pattern: A2A (Ch.15) + Multi-agent collaboration (Ch.7) + Reasoning/CoT (Ch.17)

import Fastify from 'fastify';
import { EventBus, createEventBus } from '../../../shared/utils/event-bus';
import { AgentWallet } from '../../../shared/utils/wallet-manager';
import { chainOfThought, think } from '../../../shared/utils/llm-client';
import { generateId, logger, sleep, timestamp, agentUrl } from '../../../shared/utils';
import type { NegotiationOffer, AgentIdentity, AgentRole } from '../../../shared/types';
import { AGENT_PORTS, NEGOTIATION, MESSAGE_TYPES, AGENT_CAPABILITIES } from '../../../shared/constants';
import axios from 'axios';

const ROLE: AgentRole = 'negotiation';
const PORT = AGENT_PORTS[ROLE];

const SYSTEM_PROMPT = `You are the Negotiation Agent. Your job is to negotiate fair prices for AI agent services.
Use Chain-of-Thought reasoning to evaluate offers. Consider:
- Fair market value for the service type
- Budget constraints (prefer lower prices)
- Quality signals from the offering agent
- Historical pricing from knowledge agent
Always reason through your position before deciding to accept, counter, or reject.`;

class NegotiationAgent {
  private wallet: AgentWallet;
  private bus: EventBus;
  private negotiations: Map<string, NegotiationOffer> = new Map();
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
    logger.info(ROLE, `Negotiation agent running on port ${PORT}`);

    await this.bus.subscribe(`agent:${ROLE}`, this.handleMessage.bind(this));
  }

  private setupRoutes(): void {
    this.server.get('/health', async () => ({
      status: 'ok',
      role: ROLE,
      identityKey: this.wallet.identityKey,
      activeNegotiations: this.negotiations.size,
    }));

    this.server.post('/discover', async () => ({
      identityKey: this.wallet.identityKey,
      role: ROLE,
      capabilities: AGENT_CAPABILITIES[ROLE],
      endpoint: agentUrl(ROLE),
      pricing: { basePrice: 5, currency: 'BSV', unit: 'per-negotiation' },
    }));

    // Start a new negotiation with a target agent
    this.server.post<{ Body: { targetIdentityKey: string; serviceType: string; maxBudgetSats: number } }>(
      '/negotiate',
      async (req) => {
        const { targetIdentityKey, serviceType, maxBudgetSats } = req.body;
        const result = await this.initiateNegotiation(targetIdentityKey, serviceType, maxBudgetSats);
        return result;
      }
    );

    // Receive an offer from another agent
    this.server.post<{ Body: NegotiationOffer }>('/offer', async (req) => {
      const response = await this.evaluateOffer(req.body);
      return response;
    });

    this.server.post('/execute', async (req: any) => {
      // Batch negotiate with all discovered agents
      const agents = await this.getDiscoveredAgents();
      const results = await Promise.allSettled(
        agents
          .filter((a) => a.role !== ROLE)
          .map((a) => this.initiateNegotiation(a.identityKey, 'data-query', 100))
      );
      return {
        attempted: agents.length,
        succeeded: results.filter((r) => r.status === 'fulfilled').length,
      };
    });
  }

  // ── A2A Negotiation Initiation (Ch.15) ──
  private async initiateNegotiation(
    targetIdentityKey: string,
    serviceType: string,
    maxBudgetSats: number
  ): Promise<NegotiationOffer> {
    const historyContext = await this.getHistoricalPricing(serviceType);

    // CoT reasoning to determine opening offer (Ch.17)
    const { reasoning, decision } = await chainOfThought(
      ROLE,
      `What opening price should I offer for service: "${serviceType}"?
       Max budget: ${maxBudgetSats} satoshis.
       Historical pricing: ${historyContext}`,
      `I am negotiating as a buyer. I want to pay fair but low prices.`,
      SYSTEM_PROMPT
    );

    const offerPrice = this.extractPrice(decision, maxBudgetSats);

    const offer: NegotiationOffer = {
      id: generateId(),
      fromAgent: this.wallet.identityKey,
      toAgent: targetIdentityKey,
      serviceType,
      offeredPrice: offerPrice,
      terms: { serviceType, delivery: 'immediate', quality: 'standard' },
      status: 'pending',
      timestamp: timestamp(),
    };

    this.negotiations.set(offer.id, offer);

    await this.bus.emitAgentEvent({
      agentRole: ROLE,
      eventType: 'NEGOTIATION_STARTED',
      summary: `Negotiating ${serviceType} @ ${offerPrice} sats`,
      data: { offerId: offer.id, reasoning },
    });

    // Send offer to target agent via A2A
    const result = await this.sendOffer(targetIdentityKey, offer);
    return result;
  }

  private async sendOffer(targetIdentityKey: string, offer: NegotiationOffer): Promise<NegotiationOffer> {
    // Find target endpoint
    const agents = await this.getDiscoveredAgents();
    const target = agents.find((a) => a.identityKey === targetIdentityKey);

    if (!target) {
      // If not found directly, try payment agent endpoint
      offer.status = 'accepted'; // fallback for demo
      return offer;
    }

    try {
      const resp = await axios.post(`${target.serviceEndpoint}/offer`, offer, { timeout: 10_000 });
      return resp.data as NegotiationOffer;
    } catch {
      offer.status = 'accepted'; // graceful fallback
      return offer;
    }
  }

  // ── CoT-based Offer Evaluation (Ch.17) ──
  private async evaluateOffer(offer: NegotiationOffer): Promise<NegotiationOffer> {
    const historyContext = await this.getHistoricalPricing(offer.serviceType);

    const { reasoning, decision } = await chainOfThought(
      ROLE,
      `Should I accept, counter, or reject this offer?
       Service: ${offer.serviceType}
       Offered price: ${offer.offeredPrice} satoshis
       Historical: ${historyContext}`,
      `I am the seller. I want fair compensation but also to close deals.
       My minimum acceptable price is ${NEGOTIATION.MIN_PRICE_SATS} sats.`,
      SYSTEM_PROMPT
    );

    let updatedOffer = { ...offer };

    if (decision.toLowerCase().includes('accept')) {
      updatedOffer.status = 'accepted';
      await this.notifyPaymentAgent(updatedOffer);
    } else if (decision.toLowerCase().includes('counter')) {
      const counterPrice = this.extractPrice(decision, offer.offeredPrice * 1.5);
      updatedOffer.status = 'countered';
      updatedOffer.counterPrice = counterPrice;

      // Recursive negotiation (max rounds)
      if (this.countRounds(offer.id) < NEGOTIATION.MAX_ROUNDS) {
        await sleep(500);
        updatedOffer = await this.continueNegotiation(updatedOffer, reasoning);
      }
    } else {
      updatedOffer.status = 'rejected';
    }

    this.negotiations.set(offer.id, updatedOffer);

    await this.bus.emitAgentEvent({
      agentRole: ROLE,
      eventType: `NEGOTIATION_${updatedOffer.status.toUpperCase()}`,
      summary: `Offer ${updatedOffer.status}: ${offer.serviceType} @ ${offer.offeredPrice} sats`,
      data: { offerId: offer.id, decision: updatedOffer.status, reasoning },
    });

    return updatedOffer;
  }

  private async continueNegotiation(offer: NegotiationOffer, reasoning: string): Promise<NegotiationOffer> {
    const newOffer: NegotiationOffer = {
      ...offer,
      id: offer.id,
      offeredPrice: offer.counterPrice ?? offer.offeredPrice,
      counterPrice: undefined,
      status: 'pending',
      timestamp: timestamp(),
    };
    return this.evaluateOffer(newOffer);
  }

  private async notifyPaymentAgent(offer: NegotiationOffer): Promise<void> {
    try {
      await axios.post(agentUrl('payment', '/payment-request'), {
        negotiationId: offer.id,
        fromAgent: offer.fromAgent,
        toAgent: offer.toAgent,
        amountSats: offer.offeredPrice,
        serviceType: offer.serviceType,
      }, { timeout: 5000 });
    } catch (err) {
      logger.warn(ROLE, 'Failed to notify payment agent', err);
    }
  }

  private async getHistoricalPricing(serviceType: string): Promise<string> {
    try {
      const resp = await axios.get(
        agentUrl('knowledge', `/pricing?service=${serviceType}`),
        { timeout: 3000 }
      );
      return JSON.stringify(resp.data);
    } catch {
      return `No historical data. Suggest: 1-100 sats for ${serviceType}`;
    }
  }

  private async getDiscoveredAgents(): Promise<AgentIdentity[]> {
    try {
      const resp = await axios.get(agentUrl('discovery', '/agents'), { timeout: 3000 });
      return resp.data.agents as AgentIdentity[];
    } catch {
      return [];
    }
  }

  private extractPrice(text: string, fallback: number): number {
    const match = text.match(/(\d+)\s*sat/i);
    if (match) return Math.min(parseInt(match[1]), NEGOTIATION.MAX_PRICE_SATS);
    return Math.max(1, Math.floor(fallback * (1 - NEGOTIATION.CONCESSION_RATE)));
  }

  private countRounds(offerId: string): number {
    return 0; // simplified — track in Redis for production
  }

  private async handleMessage(msg: any): Promise<void> {
    if (msg.type === MESSAGE_TYPES.NEGOTIATE_OFFER) {
      await this.evaluateOffer(msg.payload as NegotiationOffer);
    }
  }
}

const agent = new NegotiationAgent();
agent.start().catch((err) => {
  logger.error(ROLE, 'Fatal error', err);
  process.exit(1);
});
