// agents/orchestrator/src/index.ts
// Pattern: Planning (Ch.6) + Goal Monitoring (Ch.11) + Exception Recovery (Ch.12)
// Prioritization (Ch.20) + Routing (Ch.2)

import Fastify from 'fastify';
import { EventBus, createEventBus } from '../../../shared/utils/event-bus';
import { AgentWallet } from '../../../shared/utils/wallet-manager';
import { chainOfThought, think } from '../../../shared/utils/llm-client';
import { generateId, logger, sleep, timestamp, agentUrl } from '../../../shared/utils';
import type { OrchestrationTask, SubTask, AgentRole } from '../../../shared/types';
import axios from 'axios';

const ROLE: AgentRole = 'orchestrator';
const PORT = 4000;

const SYSTEM_PROMPT = `You are the Orchestrator Agent in a multi-agent BSV payment system called Agentic Pay.
Your responsibilities:
- Plan complex tasks by decomposing them into sub-tasks for specialist agents
- Monitor goal completion and detect failures
- Route tasks to the right agent (discovery, negotiation, payment, knowledge, validator)
- Re-plan when agents fail (exception recovery)
- Prioritize tasks by urgency, dependencies, and resource cost
Always think step by step. Be concise and decisive.`;

class OrchestratorAgent {
  private wallet: AgentWallet;
  private bus: EventBus;
  private activeTasks: Map<string, OrchestrationTask> = new Map();
  private server = Fastify({ logger: false });

  constructor() {
    this.wallet = new AgentWallet(ROLE);
    this.bus = createEventBus();
  }

  async start(): Promise<void> {
    await this.wallet.init();
    await this.bus.connect();
    await this.setupRoutes();
    await this.server.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(ROLE, `Orchestrator running on port ${PORT}`);

    // Start autonomous orchestration loop
    this.orchestrationLoop();
  }

  private async setupRoutes(): Promise<void> {
    this.server.get('/health', async () => ({
      status: 'ok',
      role: ROLE,
      identityKey: this.wallet.identityKey,
      activeTasks: this.activeTasks.size,
    }));

    this.server.post<{ Body: { goal: string; priority?: number } }>(
      '/task',
      async (req) => {
        const task = await this.createTask(req.body.goal, req.body.priority ?? 5);
        return { taskId: task.id, status: task.status };
      }
    );

    this.server.get('/tasks', async () => ({
      tasks: Array.from(this.activeTasks.values()),
    }));
  }

  // ── Planning (Ch.6) ──
  private async createTask(goal: string, priority: number): Promise<OrchestrationTask> {
    const { reasoning, decision } = await chainOfThought(
      ROLE,
      `Decompose this goal into sub-tasks for our specialist agents: "${goal}"`,
      `Available agents: discovery, negotiation, payment, knowledge, validator.
       Each sub-task must specify which agent handles it and what it must do.`,
      SYSTEM_PROMPT
    );

    const subTaskDefs = this.parseSubTasks(decision);
    const task: OrchestrationTask = {
      id: generateId(),
      goal,
      priority,
      status: 'planning',
      subTasks: subTaskDefs,
      createdAt: timestamp(),
    };

    this.activeTasks.set(task.id, task);
    await this.bus.emitAgentEvent({
      agentRole: ROLE,
      eventType: 'TASK_CREATED',
      summary: `New task planned: ${goal}`,
      data: { taskId: task.id, subTaskCount: task.subTasks.length, reasoning },
    });

    logger.info(ROLE, 'Task created', { taskId: task.id, subTasks: task.subTasks.length });
    return task;
  }

  // ── Routing (Ch.2) ──
  private async executeTask(task: OrchestrationTask): Promise<void> {
    task.status = 'executing';

    // Sort sub-tasks by dependencies (prioritization Ch.20)
    const ordered = this.prioritizeSubTasks(task.subTasks);

    for (const subTask of ordered) {
      subTask.status = 'running';
      try {
        const result = await this.routeToAgent(subTask);
        subTask.status = 'done';
        subTask.result = result;

        await this.bus.emitAgentEvent({
          agentRole: ROLE,
          eventType: 'SUBTASK_COMPLETE',
          summary: `Sub-task done: ${subTask.description}`,
          data: { taskId: task.id, subTaskId: subTask.id, result },
        });
      } catch (err) {
        // ── Exception Recovery (Ch.12) ──
        await this.recoverFromFailure(task, subTask, err);
      }
    }

    // ── Goal Monitoring (Ch.11) ──
    const success = await this.evaluateGoalCompletion(task);
    task.status = success ? 'complete' : 'failed';
    task.completedAt = timestamp();
  }

  private async routeToAgent(subTask: SubTask): Promise<unknown> {
    const url = agentUrl(subTask.assignedAgent, '/execute');

    const resp = await axios.post(url, {
      taskId: subTask.id,
      description: subTask.description,
    }, { timeout: 30_000 });

    return resp.data;
  }

  // ── Exception Recovery (Ch.12) ──
  private async recoverFromFailure(
    task: OrchestrationTask,
    subTask: SubTask,
    err: unknown
  ): Promise<void> {
    logger.warn(ROLE, 'Sub-task failed, attempting recovery', { subTaskId: subTask.id, err });
    subTask.error = String(err);

    const { decision } = await chainOfThought(
      ROLE,
      `Sub-task "${subTask.description}" failed with error: ${err}. 
       Should I: retry, reassign to another agent, skip, or abort the task?`,
      `Task goal: ${task.goal}. Completed sub-tasks: ${task.subTasks.filter(s => s.status === 'done').length}`,
      SYSTEM_PROMPT
    );

    if (decision.toLowerCase().includes('retry')) {
      await sleep(2000);
      try {
        subTask.result = await this.routeToAgent(subTask);
        subTask.status = 'done';
        return;
      } catch (_) { /* fall through */ }
    }

    if (decision.toLowerCase().includes('skip')) {
      subTask.status = 'failed';
      return;
    }

    task.status = 'failed';
  }

  // ── Goal Monitoring (Ch.11) ──
  private async evaluateGoalCompletion(task: OrchestrationTask): Promise<boolean> {
    const completed = task.subTasks.filter((s) => s.status === 'done').length;
    const total = task.subTasks.length;

    const { decision } = await chainOfThought(
      ROLE,
      `Has goal "${task.goal}" been achieved? ${completed}/${total} sub-tasks completed.`,
      `Sub-task results: ${JSON.stringify(task.subTasks.map(s => ({ desc: s.description, status: s.status })))}`,
      SYSTEM_PROMPT
    );

    return decision.toLowerCase().includes('yes') || completed >= Math.ceil(total * 0.8);
  }

  // ── Prioritization (Ch.20) ──
  private prioritizeSubTasks(subTasks: SubTask[]): SubTask[] {
    const order: AgentRole[] = ['discovery', 'knowledge', 'negotiation', 'payment', 'validator'];
    return [...subTasks].sort(
      (a, b) => order.indexOf(a.assignedAgent) - order.indexOf(b.assignedAgent)
    );
  }

  private parseSubTasks(llmDecision: string): SubTask[] {
    const roles: AgentRole[] = ['discovery', 'negotiation', 'payment', 'knowledge', 'validator'];
    const lines = llmDecision.split('\n').filter((l) => l.trim());
    const subTasks: SubTask[] = [];

    for (const line of lines) {
      const role = roles.find((r) => line.toLowerCase().includes(r));
      if (role) {
        subTasks.push({
          id: generateId(),
          assignedAgent: role,
          description: line.trim(),
          status: 'pending',
        });
      }
    }

    // Fallback: ensure standard pipeline exists
    if (subTasks.length === 0) {
      return roles.map((role) => ({
        id: generateId(),
        assignedAgent: role,
        description: `${role} agent: execute standard pipeline step`,
        status: 'pending',
      }));
    }

    return subTasks;
  }

  // ── Autonomous orchestration loop ──
  private async orchestrationLoop(): Promise<void> {
    // Seed an initial task to kick off autonomous operation
    await sleep(3000);
    await this.createTask(
      'Discover available agents, negotiate data exchange service, execute micro-payments for each data query handled',
      10
    );

    setInterval(async () => {
      for (const [id, task] of this.activeTasks) {
        if (task.status === 'planning') {
          await this.executeTask(task);
        }
        // Clean up old completed tasks
        if (task.status === 'complete' && task.completedAt && Date.now() - task.completedAt > 60_000) {
          this.activeTasks.delete(id);
        }
      }
    }, 5000);
  }
}

const agent = new OrchestratorAgent();
agent.start().catch((err) => {
  logger.error(ROLE, 'Fatal error', err);
  process.exit(1);
});
