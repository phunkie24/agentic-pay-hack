// agents/validator/src/index.ts
// Pattern: Reflection (Ch.4) + Guardrails (Ch.18) + Human-in-the-Loop (Ch.13)

import Fastify from 'fastify';
import { EventBus, createEventBus } from '../../../shared/utils/event-bus';
import { AgentWallet } from '../../../shared/utils/wallet-manager';
import { chainOfThought } from '../../../shared/utils/llm-client';
import { generateId, logger, timestamp, agentUrl } from '../../../shared/utils';
import type { PaymentTransaction, ValidationResult, AgentRole } from '../../../shared/types';
import { AGENT_PORTS, AGENT_CAPABILITIES } from '../../../shared/constants';

const ROLE: AgentRole = 'validator';
const PORT = AGENT_PORTS[ROLE];

const SYSTEM_PROMPT = `You are the Validator Agent — the quality and safety guardian of the Agentic Pay system.
Your responsibilities:
- Validate every payment transaction for correctness and fairness
- Detect anomalies: unusual amounts, duplicate payments, suspicious patterns  
- Apply guardrails to prevent: fraud, excessive spending, malformed transactions
- Escalate high-risk cases to human review (HITL)
- Provide reflection feedback to improve agent behavior over time
Be thorough but fair. Score 0-100. Flag anything above risk threshold.`;

const RISK_THRESHOLD = 70;      // Score above this = HITL required
const MAX_SINGLE_PAYMENT = 10_000; // Satoshis guardrail
const ANOMALY_WINDOW = 60_000;  // 1 minute window for rate limiting

class ValidatorAgent {
  private wallet: AgentWallet;
  private bus: EventBus;
  private validationLog: Array<{ tx: PaymentTransaction; result: ValidationResult }> = [];
  private recentPayments: Map<string, number[]> = new Map(); // agent -> timestamps
  private hitlQueue: PaymentTransaction[] = [];
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
    logger.info(ROLE, `Validator agent running on port ${PORT}`);

    this.startPeriodicReflection();
  }

  private setupRoutes(): void {
    this.server.get('/health', async () => ({
      status: 'ok',
      role: ROLE,
      identityKey: this.wallet.identityKey,
      validatedCount: this.validationLog.length,
      hitlQueueSize: this.hitlQueue.length,
    }));

    this.server.post('/discover', async () => ({
      identityKey: this.wallet.identityKey,
      role: ROLE,
      capabilities: AGENT_CAPABILITIES[ROLE],
      endpoint: agentUrl(ROLE),
      pricing: { basePrice: 1, currency: 'BSV', unit: 'per-validation' },
    }));

    // Main validation endpoint
    this.server.post<{ Body: PaymentTransaction }>('/validate', async (req) => {
      const result = await this.validateTransaction(req.body);
      return result;
    });

    // HITL review endpoint (human calls this to approve/reject)
    this.server.post<{ Body: { txId: string; approved: boolean; reason: string } }>(
      '/hitl/review',
      async (req) => {
        const { txId, approved, reason } = req.body;
        return this.processHITLDecision(txId, approved, reason);
      }
    );

    this.server.get('/hitl/queue', async () => ({
      queue: this.hitlQueue,
      count: this.hitlQueue.length,
    }));

    this.server.get('/validation-log', async () => ({
      log: this.validationLog.slice(-50),
      total: this.validationLog.length,
      passRate: this.calculatePassRate(),
    }));

    this.server.post('/execute', async (req: any) => {
      // Self-reflection on recent validations
      const report = await this.reflectOnRecentValidations();
      return report;
    });
  }

  // ── Reflection (Ch.4) — Producer-Critic model ──
  private async validateTransaction(tx: PaymentTransaction): Promise<ValidationResult> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // ── Guardrails layer 1: Rule-based checks (Ch.18) ──
    if (tx.amountSatoshis <= 0) issues.push('Invalid amount: must be positive');
    if (tx.amountSatoshis > MAX_SINGLE_PAYMENT) {
      issues.push(`Amount ${tx.amountSatoshis} exceeds max ${MAX_SINGLE_PAYMENT} sats`);
    }
    if (!tx.fromAgent || !tx.toAgent) issues.push('Missing agent identifiers');
    if (tx.fromAgent === tx.toAgent) issues.push('Self-payment detected');

    // ── Guardrails layer 2: Rate limiting (Ch.18) ──
    const rateIssue = this.checkRateLimit(tx.fromAgent);
    if (rateIssue) issues.push(rateIssue);

    // ── Guardrails layer 3: Duplicate detection ──
    const isDuplicate = this.isDuplicate(tx);
    if (isDuplicate) issues.push('Potential duplicate transaction detected');

    // ── LLM-based reflection / critique (Ch.4 critic agent) ──
    const { reasoning, decision } = await chainOfThought(
      ROLE,
      `Evaluate this BSV payment transaction:
       From: ${tx.fromAgent.slice(0, 16)}...
       To: ${tx.toAgent.slice(0, 16)}...
       Amount: ${tx.amountSatoshis} satoshis
       Service: ${JSON.stringify(tx.metadata)}
       Pre-check issues: ${issues.join(', ') || 'none'}
       
       Assign a risk score (0=safe, 100=very risky) and explain why.`,
      `Flag transactions that seem: fraudulent, artificially inflated, or malformed.
       Approve routine micro-payments (1-1000 sats) for legitimate service exchanges.`,
      SYSTEM_PROMPT
    );

    const score = this.extractRiskScore(decision);
    const requiresHITL = score > RISK_THRESHOLD || issues.length > 2;

    if (score > 50) {
      recommendations.push('Consider reducing batch size');
      recommendations.push('Verify service type matches payment amount');
    }

    const result: ValidationResult = {
      valid: issues.length === 0 && score <= RISK_THRESHOLD,
      score,
      issues,
      recommendations,
      requiresHITL,
      timestamp: timestamp(),
    };

    this.validationLog.push({ tx, result });
    this.trackPayment(tx.fromAgent);

    await this.bus.emitAgentEvent({
      agentRole: ROLE,
      eventType: result.valid ? 'VALIDATION_PASSED' : 'VALIDATION_FAILED',
      summary: `Tx validated: score=${score}, valid=${result.valid}`,
      data: { txId: tx.id, score, issues, reasoning },
      txid: tx.txid,
    });

    // ── HITL escalation (Ch.13) ──
    if (requiresHITL) {
      this.hitlQueue.push(tx);
      logger.warn(ROLE, 'Transaction escalated to HITL', { txId: tx.id, score });
    }

    return result;
  }

  // ── Reflection (Ch.4) — Periodic self-review ──
  private async reflectOnRecentValidations(): Promise<{
    reflection: string;
    improvements: string[];
    passRate: number;
  }> {
    const recent = this.validationLog.slice(-20);
    if (recent.length === 0) return { reflection: 'No recent validations', improvements: [], passRate: 100 };

    const summary = recent.map(({ tx, result }) =>
      `Amount: ${tx.amountSatoshis} sats, Valid: ${result.valid}, Score: ${result.score}`
    ).join('\n');

    const { reasoning, decision } = await chainOfThought(
      ROLE,
      `Reflect on these recent ${recent.length} validation results:\n${summary}\n
       What patterns do you see? What improvements should the system make?`,
      'You are reflecting on your own validation decisions to improve quality.',
      SYSTEM_PROMPT
    );

    const improvements = decision
      .split('\n')
      .filter((l) => l.trim().startsWith('-') || l.trim().startsWith('•'))
      .map((l) => l.replace(/^[-•]\s*/, '').trim())
      .slice(0, 5);

    await this.bus.emitAgentEvent({
      agentRole: ROLE,
      eventType: 'REFLECTION_COMPLETE',
      summary: 'Periodic self-reflection on validation patterns',
      data: { improvements, reasoning, passRate: this.calculatePassRate() },
    });

    return { reflection: reasoning, improvements, passRate: this.calculatePassRate() };
  }

  // ── HITL processing (Ch.13) ──
  private async processHITLDecision(txId: string, approved: boolean, reason: string): Promise<{
    processed: boolean;
    txId: string;
    decision: 'approved' | 'rejected';
  }> {
    const idx = this.hitlQueue.findIndex((tx) => tx.id === txId);
    if (idx === -1) return { processed: false, txId, decision: approved ? 'approved' : 'rejected' };

    this.hitlQueue.splice(idx, 1);

    await this.bus.emitAgentEvent({
      agentRole: ROLE,
      eventType: approved ? 'HITL_APPROVED' : 'HITL_REJECTED',
      summary: `Human ${approved ? 'approved' : 'rejected'} tx ${txId}: ${reason}`,
      data: { txId, approved, reason },
    });

    return { processed: true, txId, decision: approved ? 'approved' : 'rejected' };
  }

  private checkRateLimit(agentId: string): string | null {
    const now = Date.now();
    const times = this.recentPayments.get(agentId) ?? [];
    const windowTimes = times.filter((t) => now - t < ANOMALY_WINDOW);

    if (windowTimes.length > 10000) {
      return `Rate limit exceeded: ${windowTimes.length} payments in 60s`;
    }
    return null;
  }

  private trackPayment(agentId: string): void {
    const times = this.recentPayments.get(agentId) ?? [];
    times.push(Date.now());
    // Keep only last 1 minute
    const now = Date.now();
    this.recentPayments.set(agentId, times.filter((t) => now - t < ANOMALY_WINDOW));
  }

  private isDuplicate(tx: PaymentTransaction): boolean {
    const recent = this.validationLog.slice(-50);
    return recent.some(
      ({ tx: prev }) =>
        prev.fromAgent === tx.fromAgent &&
        prev.toAgent === tx.toAgent &&
        prev.amountSatoshis === tx.amountSatoshis &&
        Math.abs(prev.timestamp - tx.timestamp) < 1000
    );
  }

  private extractRiskScore(text: string): number {
    const match = text.match(/(\d+)/);
    if (match) return Math.min(100, Math.max(0, parseInt(match[1])));
    if (text.toLowerCase().includes('low risk')) return 10;
    if (text.toLowerCase().includes('high risk')) return 80;
    return 20;
  }

  private calculatePassRate(): number {
    if (this.validationLog.length === 0) return 100;
    const passed = this.validationLog.filter(({ result }) => result.valid).length;
    return Math.round((passed / this.validationLog.length) * 100);
  }

  private startPeriodicReflection(): void {
    setInterval(() => this.reflectOnRecentValidations(), 60_000);
  }
}

const agent = new ValidatorAgent();
agent.start().catch((err) => {
  logger.error(ROLE, 'Fatal error', err);
  process.exit(1);
});
