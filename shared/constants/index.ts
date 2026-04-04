// shared/constants/index.ts

export const AGENT_PORTS = {
  orchestrator: 4000,
  discovery:    4001,
  negotiation:  4002,
  payment:      4003,
  knowledge:    4004,
  validator:    4005,
} as const;

export const AGENT_CAPABILITIES = {
  discovery:   ['brc100-identity', 'agent-lookup', 'capability-broadcast'],
  negotiation: ['price-negotiation', 'a2a-protocol', 'cot-reasoning'],
  payment:     ['bsv-micropayment', 'batch-tx', 'utxo-management'],
  knowledge:   ['rag-retrieval', 'embedding', 'context-augmentation'],
  validator:   ['reflection', 'guardrails', 'hitl-escalation'],
  orchestrator:['planning', 'routing', 'goal-monitoring', 'exception-recovery'],
} as const;

export const NEGOTIATION = {
  MAX_ROUNDS:      5,
  TIMEOUT_MS:      30_000,
  MIN_PRICE_SATS:  1,
  MAX_PRICE_SATS:  10_000,
  CONCESSION_RATE: 0.1,   // 10% price concession per round
} as const;

export const PAYMENT = {
  BATCH_SIZE:         500,   // tx per batch
  BATCH_INTERVAL_MS:  50,    // ms between batches → ~10 batches/sec → 300k/hr
  TARGET_TX_24H:      1_500_000,
  MIN_FEE_SATS:       1,
  DEFAULT_AMOUNT_SATS:10,
} as const;

export const REDIS_KEYS = {
  AGENT_STATE:    (role: string) => `agent:state:${role}`,
  DISCOVERED:     'agents:discovered',
  NEGOTIATIONS:   'negotiations:active',
  TX_COUNT:       'metrics:tx_count',
  TX_COUNT_24H:   'metrics:tx_count_24h',
  EVENTS:         'events:stream',
} as const;

export const CHROMA = {
  COLLECTION:    'agentic-pay-knowledge',
  TOP_K:         5,
  MIN_RELEVANCE: 0.7,
} as const;

export const MESSAGE_TYPES = {
  DISCOVER:          'DISCOVER',
  DISCOVER_RESPONSE: 'DISCOVER_RESPONSE',
  NEGOTIATE_OFFER:   'NEGOTIATE_OFFER',
  NEGOTIATE_COUNTER: 'NEGOTIATE_COUNTER',
  NEGOTIATE_ACCEPT:  'NEGOTIATE_ACCEPT',
  NEGOTIATE_REJECT:  'NEGOTIATE_REJECT',
  PAYMENT_INIT:      'PAYMENT_INIT',
  PAYMENT_CONFIRM:   'PAYMENT_CONFIRM',
  VALIDATE_REQUEST:  'VALIDATE_REQUEST',
  VALIDATE_RESULT:   'VALIDATE_RESULT',
  KNOWLEDGE_QUERY:   'KNOWLEDGE_QUERY',
  KNOWLEDGE_RESPONSE:'KNOWLEDGE_RESPONSE',
} as const;
