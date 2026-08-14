import type { AgentRun } from '../domain/run/types.js';
import type { Message } from '@earendil-works/pi-ai';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

export interface ExecutionBudgetUsage {
  messages: number;
  tokens: number;
}

export function newExecutionBudgetUsage(): ExecutionBudgetUsage {
  return { messages: 0, tokens: 0 };
}

export function assertExecutionBudget(run: AgentRun, usage: ExecutionBudgetUsage): void {
  const limits = run.executionPlanSnapshot?.limits;
  if (!limits) return;
  if (usage.messages > limits.maxMessages) {
    throw new RuntimeError('RUN_CONFLICT', 'Execution message budget is exhausted', false, {
      reason: 'maxMessages', max: limits.maxMessages, actual: usage.messages,
    });
  }
  if (usage.tokens > limits.maxTokens) {
    throw new RuntimeError('RUN_CONFLICT', 'Execution token budget is exhausted', false, {
      reason: 'maxTokens', max: limits.maxTokens, actual: usage.tokens,
    });
  }
}

export function recordExecutionMessage(usage: ExecutionBudgetUsage, message: { role?: string; usage?: { totalTokens?: number } }): void {
  usage.messages += 1;
  if (message.role === 'assistant' && Number.isSafeInteger(message.usage?.totalTokens) && (message.usage?.totalTokens ?? 0) > 0) {
    usage.tokens += message.usage!.totalTokens!;
  }
}

export function consumeExecutionMessage(uow: RuntimeUnitOfWork, run: AgentRun, message: Message, at: Date): void {
  const budget = ensureBudget(uow, run, at);
  const tokens = message.role === 'assistant' && Number.isSafeInteger(message.usage?.totalTokens)
    ? Math.max(0, message.usage?.totalTokens ?? 0) : 0;
  const next = { ...budget, messages: budget.messages + 1, tokens: budget.tokens + tokens, updatedAt: new Date(at.getTime()) };
  assertBudget(run, next);
  uow.executionBudgets.update(next);
}

export function consumeExecutionAgentRun(uow: RuntimeUnitOfWork, run: AgentRun, at: Date): void {
  const budget = ensureBudget(uow, run, at);
  const next = { ...budget, agentRuns: budget.agentRuns + 1, updatedAt: new Date(at.getTime()) };
  assertBudget(run, next, 'maxAgentRuns');
  uow.executionBudgets.update(next);
}

function ensureBudget(uow: RuntimeUnitOfWork, run: AgentRun, at: Date) {
  const existing = uow.executionBudgets.get(run.runId);
  if (existing) return existing;
  const nodes = uow.executionNodes.listByRun(run.runId);
  const entries = readAllEntries(uow, run.runId);
  let tokens = 0;
  for (const entry of entries) {
    const message = entry.message;
    if (message?.role === 'assistant' && Number.isSafeInteger(message.usage?.totalTokens)) tokens += Math.max(0, message.usage?.totalTokens ?? 0);
  }
  const budget = { tenantId: run.tenantId, runId: run.runId, agentRuns: Math.max(1, nodes.length), messages: entries.filter((entry) => isBudgetMessage(entry.message)).length, tokens, updatedAt: new Date(at.getTime()) };
  uow.executionBudgets.insert(budget);
  return budget;
}

function isBudgetMessage(message: Message | undefined): boolean {
  return message?.role === 'user' || message?.role === 'assistant' || message?.role === 'toolResult';
}

function assertBudget(run: AgentRun, usage: { agentRuns: number; messages: number; tokens: number }, reason?: 'maxAgentRuns'): void {
  const limits = run.executionPlanSnapshot?.limits;
  if (!limits) return;
  const check = reason === 'maxAgentRuns' || reason === undefined ? usage.agentRuns > limits.maxAgentRuns : false;
  if (check) throw budgetConflict('maxAgentRuns', limits.maxAgentRuns, usage.agentRuns);
  if (reason === undefined && usage.messages > limits.maxMessages) throw budgetConflict('maxMessages', limits.maxMessages, usage.messages);
  if (reason === undefined && usage.tokens > limits.maxTokens) throw budgetConflict('maxTokens', limits.maxTokens, usage.tokens);
}

function budgetConflict(reason: string, max: number, actual: number): RuntimeError {
  return new RuntimeError('RUN_CONFLICT', 'Execution budget is exhausted', false, { reason, max, actual });
}

function readAllEntries(uow: RuntimeUnitOfWork, runId: string) {
  const result = [] as ReturnType<RuntimeUnitOfWork['executionEntries']['listByRun']>;
  let after = 0;
  for (;;) {
    const page = uow.executionEntries.listByRun(runId, after, 500);
    result.push(...page);
    if (page.length < 500) return result;
    after = page.at(-1)?.sequence ?? after;
  }
}
