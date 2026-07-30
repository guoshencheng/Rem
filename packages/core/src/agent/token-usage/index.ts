import type { Usage } from '@earendil-works/pi-ai';

export interface TokenUsageDetail extends Usage {
  runAt: Date;
  turns: Usage[];
}

export function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function addCost(a: Usage['cost'], b: Usage['cost']): Usage['cost'] {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: addCost(a.cost, b.cost),
    reasoning: a.reasoning ?? b.reasoning,
  };
}

export function computeCacheStats(usage: Usage): {
  cacheRead: number;
  cacheWrite: number;
  noCache: number;
} {
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  return {
    cacheRead,
    cacheWrite,
    noCache: Math.max(0, usage.input - cacheRead - cacheWrite),
  };
}

export function computeCacheRatio(usage: Usage): number {
  if (usage.totalTokens === 0) return 0;
  return (usage.cacheRead + usage.cacheWrite) / usage.totalTokens;
}

export function formatUsage(usage: Usage): string {
  return `${usage.totalTokens.toLocaleString()} tokens (${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out)`;
}

export function formatCost(cost: Usage['cost']): string {
  const total = cost.total ?? 0;
  return total >= 1 ? `$${total.toFixed(2)}` : `$${total.toFixed(4)}`;
}

export function normalizeUsage(usage: unknown): Usage {
  if (!usage || typeof usage !== 'object') return emptyUsage();
  const u = usage as Record<string, any>;

  const input = typeof u.input === 'number' ? u.input : (typeof u.inputTokens === 'number' ? u.inputTokens : 0);
  const output = typeof u.output === 'number' ? u.output : (typeof u.outputTokens === 'number' ? u.outputTokens : 0);
  const totalTokens = typeof u.totalTokens === 'number' ? u.totalTokens : input + output;

  const inputDetails = u.inputTokenDetails ?? {};
  const cacheRead = typeof u.cacheRead === 'number'
    ? u.cacheRead
    : (typeof inputDetails.cacheReadTokens === 'number' ? inputDetails.cacheReadTokens : 0);
  const cacheWrite = typeof u.cacheWrite === 'number'
    ? u.cacheWrite
    : (typeof inputDetails.cacheWriteTokens === 'number' ? inputDetails.cacheWriteTokens : 0);

  const outputDetails = u.outputTokenDetails ?? {};
  const reasoning = typeof u.reasoning === 'number'
    ? u.reasoning
    : (typeof outputDetails.reasoningTokens === 'number' ? outputDetails.reasoningTokens : undefined);

  const cost = u.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

  return { input, output, cacheRead, cacheWrite, totalTokens, cost, reasoning };
}

export function normalizeUsageDetail(detail: unknown): TokenUsageDetail {
  const base = normalizeUsage(detail);
  const d = detail as Record<string, any>;
  const runAt = d.runAt instanceof Date ? d.runAt : new Date(d.runAt ?? Date.now());
  const turns = Array.isArray(d.turns)
    ? d.turns.map((turn: unknown) => normalizeUsage(turn))
    : [base];
  return { ...base, runAt, turns };
}

export function reduceTokenUsage(details: Array<unknown>): number {
  return details.map((entry) =>
    normalizeUsageDetail(entry as TokenUsageDetail)).reduce((sum, entry) => sum + entry.totalTokens, 0);
}