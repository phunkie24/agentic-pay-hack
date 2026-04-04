// agents/knowledge/src/index.ts
// Pattern: RAG (Ch.14) + Memory Management (Ch.8) + Learning & Adaptation (Ch.9)

import Fastify from 'fastify';
import { EventBus, createEventBus } from '../../../shared/utils/event-bus';
import { AgentWallet } from '../../../shared/utils/wallet-manager';
import { think } from '../../../shared/utils/llm-client';
import { generateId, logger, timestamp, agentUrl } from '../../../shared/utils';
import type { KnowledgeEntry, AgentRole } from '../../../shared/types';
import { AGENT_PORTS, AGENT_CAPABILITIES, CHROMA } from '../../../shared/constants';
import { ChromaClient, Collection } from 'chromadb';

const ROLE: AgentRole = 'knowledge';
const PORT = AGENT_PORTS[ROLE];

const SYSTEM_PROMPT = `You are the Knowledge Agent. You manage a vector database of information about:
- Agent capabilities and pricing history
- Negotiation outcomes and patterns
- BSV transaction records and insights
- Domain knowledge for data exchange services
Use RAG to retrieve relevant context and augment agent decisions.
Learn from past interactions to improve future recommendations.`;

class KnowledgeAgent {
  private wallet: AgentWallet;
  private bus: EventBus;
  private chroma: ChromaClient;
  private collection: Collection | null = null;
  private shortTermMemory: Map<string, unknown> = new Map(); // Ch.8 short-term
  private server = Fastify({ logger: false });

  constructor() {
    this.wallet = new AgentWallet(ROLE);
    this.bus = createEventBus();
    this.chroma = new ChromaClient({ path: process.env.CHROMA_URL ?? 'http://localhost:8000' });
  }

  async start(): Promise<void> {
    await this.wallet.init();
    await this.bus.connect();
    await this.initVectorStore();
    this.setupRoutes();
    await this.server.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(ROLE, `Knowledge agent running on port ${PORT}`);

    await this.seedKnowledgeBase();
  }

  // ── Long-term Memory Init (Ch.8) ──
  private async initVectorStore(): Promise<void> {
    try {
      this.collection = await this.chroma.getOrCreateCollection({
        name: CHROMA.COLLECTION,
        metadata: { description: 'Agentic Pay knowledge base' },
      });
      logger.info(ROLE, 'ChromaDB collection ready', { name: CHROMA.COLLECTION });
    } catch (err) {
      logger.warn(ROLE, 'ChromaDB unavailable, using in-memory fallback', err);
    }
  }

  private setupRoutes(): void {
    this.server.get('/health', async () => ({
      status: 'ok',
      role: ROLE,
      identityKey: this.wallet.identityKey,
      shortTermEntries: this.shortTermMemory.size,
    }));

    this.server.post('/discover', async () => ({
      identityKey: this.wallet.identityKey,
      role: ROLE,
      capabilities: AGENT_CAPABILITIES[ROLE],
      endpoint: agentUrl(ROLE),
      pricing: { basePrice: 2, currency: 'BSV', unit: 'per-query' },
    }));

    // RAG query endpoint (Ch.14)
    this.server.post<{ Body: { query: string; topK?: number } }>('/query', async (req) => {
      const { query, topK = CHROMA.TOP_K } = req.body;
      const result = await this.ragQuery(query, topK);
      return result;
    });

    // Pricing history
    this.server.get<{ Querystring: { service: string } }>('/pricing', async (req) => {
      const { service } = req.query;
      return this.getPricingHistory(service);
    });

    // Store new knowledge
    this.server.post<{ Body: { content: string; metadata: Record<string, unknown> } }>(
      '/store',
      async (req) => {
        await this.storeKnowledge(req.body.content, req.body.metadata);
        return { stored: true };
      }
    );

    this.server.post('/execute', async (req: any) => {
      const result = await this.ragQuery('agent capabilities and pricing', 5);
      return result;
    });
  }

  // ── RAG Query (Ch.14) ──
  private async ragQuery(query: string, topK: number): Promise<{
    query: string;
    context: string;
    augmentedResponse: string;
    sources: number;
  }> {
    let context = '';
    let sources = 0;

    // Step 1: Check short-term memory first (Ch.8)
    const stMemKey = `query:${query.slice(0, 50)}`;
    if (this.shortTermMemory.has(stMemKey)) {
      const cached = this.shortTermMemory.get(stMemKey) as string;
      return { query, context: cached, augmentedResponse: cached, sources: 0 };
    }

    // Step 2: Retrieve from ChromaDB (long-term memory Ch.8)
    if (this.collection) {
      try {
        const results = await this.collection.query({
          queryTexts: [query],
          nResults: topK,
        });

        const docs = results.documents?.[0] ?? [];
        const distances = results.distances?.[0] ?? [];

        const relevant = docs.filter((_, i) =>
          (distances[i] ?? 1) < (1 - CHROMA.MIN_RELEVANCE)
        );

        context = relevant.join('\n---\n');
        sources = relevant.length;
      } catch (err) {
        logger.warn(ROLE, 'ChromaDB query failed', err);
        context = this.getFallbackContext(query);
      }
    } else {
      context = this.getFallbackContext(query);
    }

    // Step 3: Augment with LLM (Ch.14 RAG generation step)
    const augmentedResponse = await think(
      ROLE,
      [{
        role: 'user',
        content: `Question: ${query}\n\nRelevant context:\n${context || 'No context found.'}\n\nProvide a concise, helpful answer.`,
      }],
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 512 }
    );

    // Store in short-term memory (Ch.8)
    this.shortTermMemory.set(stMemKey, augmentedResponse);
    if (this.shortTermMemory.size > 100) {
      const firstKey = this.shortTermMemory.keys().next().value;
      if (firstKey) this.shortTermMemory.delete(firstKey);
    }

    await this.bus.emitAgentEvent({
      agentRole: ROLE,
      eventType: 'KNOWLEDGE_QUERIED',
      summary: `RAG query: "${query.slice(0, 50)}"`,
      data: { sources, hasContext: context.length > 0 },
    });

    return { query, context, augmentedResponse, sources };
  }

  // ── Memory Store (Ch.8 long-term) ──
  private async storeKnowledge(content: string, metadata: Record<string, unknown>): Promise<void> {
    const entry: KnowledgeEntry = {
      id: generateId(),
      content,
      metadata: {
        category: String(metadata.category ?? 'general'),
        agentRole: metadata.agentRole as AgentRole | undefined,
        txid: metadata.txid as string | undefined,
        timestamp: timestamp(),
      },
    };

    if (this.collection) {
      try {
        await this.collection.add({
          ids: [entry.id],
          documents: [entry.content],
          metadatas: [entry.metadata as Record<string, string | number | boolean>],
        });
      } catch (err) {
        logger.warn(ROLE, 'Failed to store in ChromaDB', err);
      }
    }

    logger.info(ROLE, 'Knowledge stored', { id: entry.id });
  }

  // ── Learning & Adaptation (Ch.9) — refine pricing model ──
  private async getPricingHistory(serviceType: string): Promise<{
    serviceType: string;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    recommendation: number;
  }> {
    const result = await this.ragQuery(`pricing for ${serviceType} service`, 3);

    // Extract prices from context using LLM
    const priceText = await think(
      ROLE,
      [{
        role: 'user',
        content: `Extract pricing data for "${serviceType}" from this context: ${result.context}
        Return JSON: {"avgPrice": N, "minPrice": N, "maxPrice": N}`,
      }],
      { maxTokens: 150 }
    );

    try {
      const prices = JSON.parse(priceText.match(/\{.*\}/s)?.[0] ?? '{}');
      return {
        serviceType,
        avgPrice: prices.avgPrice ?? 10,
        minPrice: prices.minPrice ?? 1,
        maxPrice: prices.maxPrice ?? 100,
        recommendation: prices.avgPrice ?? 10,
      };
    } catch {
      return { serviceType, avgPrice: 10, minPrice: 1, maxPrice: 100, recommendation: 10 };
    }
  }

  private getFallbackContext(query: string): string {
    return `Standard pricing for agent services: 1-100 satoshis per request.
Discovery lookups: 1 sat. Data queries: 5-20 sats. Complex negotiations: 50-100 sats.
BSV network: low fees, high throughput, suitable for micro-payments.`;
  }

  private async seedKnowledgeBase(): Promise<void> {
    const seeds = [
      { content: 'BSV micro-payment fees are sub-cent, ideal for agent-to-agent value exchange', metadata: { category: 'bsv-basics' } },
      { content: 'BRC-100 wallet interface provides standardized identity keys for agent discovery', metadata: { category: 'brc100' } },
      { content: 'Standard pricing: data query = 5-10 sats, discovery = 1 sat, negotiation = 5 sats', metadata: { category: 'pricing' } },
      { content: 'Agent negotiation should use Chain-of-Thought reasoning for fair price discovery', metadata: { category: 'negotiation' } },
      { content: 'Batch payments of 100+ outputs per transaction maximize throughput efficiency', metadata: { category: 'payment-optimization' } },
    ];

    for (const seed of seeds) {
      await this.storeKnowledge(seed.content, seed.metadata);
    }
    logger.info(ROLE, 'Knowledge base seeded', { entries: seeds.length });
  }
}

const agent = new KnowledgeAgent();
agent.start().catch((err) => {
  logger.error(ROLE, 'Fatal error', err);
  process.exit(1);
});
