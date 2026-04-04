// shared/utils/llm-client.ts
// Shared Anthropic Claude client used by all agents for reasoning

import Anthropic from '@anthropic-ai/sdk';
import type { AgentRole } from '../types';
import { logger } from './index';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  maxTokens?: number;
  systemPrompt?: string;
  temperature?: number;
}

export async function think(
  agentRole: AgentRole,
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<string> {
  const { maxTokens = 1024, systemPrompt, temperature = 0.3 } = options;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });

    const text = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('');

    logger.info(agentRole, 'LLM response received', {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return text;
  } catch (err) {
    logger.error(agentRole, 'LLM call failed', err);
    throw err;
  }
}

export async function thinkWithTools(
  agentRole: AgentRole,
  messages: LLMMessage[],
  tools: Anthropic.Tool[],
  options: LLMOptions = {}
): Promise<{ text: string; toolCalls: Anthropic.ToolUseBlock[] }> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: options.maxTokens ?? 2048,
    system: options.systemPrompt,
    messages,
    tools,
  });

  const text = response.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { type: 'text'; text: string }).text)
    .join('');

  const toolCalls = response.content.filter(
    (c) => c.type === 'tool_use'
  ) as Anthropic.ToolUseBlock[];

  logger.info(agentRole, 'LLM tool response', { toolCalls: toolCalls.length });
  return { text, toolCalls };
}

export async function chainOfThought(
  agentRole: AgentRole,
  task: string,
  context: string,
  systemPrompt: string
): Promise<{ reasoning: string; decision: string }> {
  const prompt = `
Context: ${context}

Task: ${task}

Think step by step. First reason through the problem, then state your decision.
Format your response as:
REASONING: <your step-by-step reasoning>
DECISION: <your final decision or action>
`;

  const response = await think(agentRole, [{ role: 'user', content: prompt }], {
    systemPrompt,
    maxTokens: 1500,
  });

  const reasoningMatch = response.match(/REASONING:([\s\S]*?)DECISION:/);
  const decisionMatch = response.match(/DECISION:([\s\S]*?)$/);

  return {
    reasoning: reasoningMatch?.[1]?.trim() ?? '',
    decision: decisionMatch?.[1]?.trim() ?? response,
  };
}
