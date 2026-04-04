// shared/types/index.ts
// Central type definitions used across all agents

export type AgentRole =
  | 'orchestrator'
  | 'discovery'
  | 'negotiation'
  | 'payment'
  | 'knowledge'
  | 'validator';

export type NetworkType = 'testnet' | 'mainnet';

export interface AgentIdentity {
  role: AgentRole;
  identityKey: string;       // BRC-100 public identity key
  walletAddress: string;
  capabilities: string[];
  serviceEndpoint: string;   // MessageBox or HTTP endpoint
  pricingModel: PricingModel;
}

export interface PricingModel {
  basePrice: number;         // satoshis
  currency: 'BSV';
  unit: string;              // e.g. 'per-request', 'per-mb', 'per-query'
}

export interface NegotiationOffer {
  id: string;
  fromAgent: string;         // identity key
  toAgent: string;
  serviceType: string;
  offeredPrice: number;      // satoshis
  counterPrice?: number;
  terms: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected' | 'countered';
  timestamp: number;
}

export interface PaymentTransaction {
  id: string;
  fromAgent: string;
  toAgent: string;
  amountSatoshis: number;
  txid?: string;
  beefHex?: string;
  status: 'pending' | 'broadcast' | 'confirmed' | 'failed';
  negotiationId: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface AgentMessage {
  id: string;
  type: AgentMessageType;
  fromAgent: string;
  toAgent: string;
  payload: unknown;
  timestamp: number;
}

export type AgentMessageType =
  | 'DISCOVER'
  | 'DISCOVER_RESPONSE'
  | 'NEGOTIATE_OFFER'
  | 'NEGOTIATE_COUNTER'
  | 'NEGOTIATE_ACCEPT'
  | 'NEGOTIATE_REJECT'
  | 'PAYMENT_INIT'
  | 'PAYMENT_CONFIRM'
  | 'VALIDATE_REQUEST'
  | 'VALIDATE_RESULT'
  | 'KNOWLEDGE_QUERY'
  | 'KNOWLEDGE_RESPONSE'
  | 'HEARTBEAT';

export interface AgentEvent {
  id: string;
  agentRole: AgentRole;
  eventType: string;
  summary: string;
  data: unknown;
  txid?: string;
  timestamp: number;
}

export interface OrchestrationTask {
  id: string;
  goal: string;
  subTasks: SubTask[];
  status: 'planning' | 'executing' | 'validating' | 'complete' | 'failed';
  priority: number;
  createdAt: number;
  completedAt?: number;
}

export interface SubTask {
  id: string;
  assignedAgent: AgentRole;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
  error?: string;
}

export interface KnowledgeEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    category: string;
    agentRole?: AgentRole;
    txid?: string;
    timestamp: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  score: number;           // 0-100
  issues: string[];
  recommendations: string[];
  requiresHITL: boolean;
  timestamp: number;
}

export interface SystemMetrics {
  totalTransactions: number;
  transactionsLast24h: number;
  totalSatoshisExchanged: number;
  activeAgents: number;
  avgNegotiationTimeMs: number;
  successRate: number;
  timestamp: number;
}
