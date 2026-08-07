import { describe, expect, it, vi } from 'vitest';
import { reduceStreamEvent, compactContentBlocks, type StreamingContentBlock } from '../src/agent/event-aggregators.js';
import { IterationBudget, type BudgetConfig } from '../src/agent/budget.js';
import { emptyUsage, addCost, addUsage, computeCacheStats, computeCacheRatio, formatUsage, formatCost, normalizeUsage, normalizeUsageDetail, reduceTokenUsage, type TokenUsageDetail } from '../src/agent/token-usage/index.js';
import { buildAgentOutput, buildAgentErrorOutput, agentOutputErrorMessage } from '../src/agent/agent-output.js';
import { forkSessionTitleGeneration } from '../src/agent/session-title.js';
import type { AssistantMessage, Usage, AssistantMessageEvent, Message } from '@earendil-works/pi-ai';
import type { AgentDI } from '../src/assembly/agent-di.js';
import type { Session } from '../src/session/model.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 's-1',
    conversation: [],
    currentTurn: 0,
    metadata: { schemaVersion: 2 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── event-aggregators ───────────────────────────────────────────

describe('reduceStreamEvent', () => {
  it('text_start creates empty text block at contentIndex', () => {
    const result = reduceStreamEvent([], { type: 'text_start', contentIndex: 0 } as any);
    expect(result[0]).toEqual({ type: 'text', text: '' });
  });

  it('text_delta appends to existing text block', () => {
    const before = [{ type: 'text' as const, text: 'Hello' }];
    const result = reduceStreamEvent(before, { type: 'text_delta', contentIndex: 0, delta: ' World' } as any);
    expect(result[0]).toEqual({ type: 'text', text: 'Hello World' });
  });

  it('text_delta starts new text block when slot is undefined', () => {
    const result = reduceStreamEvent([undefined], { type: 'text_delta', contentIndex: 0, delta: 'Hello' } as any);
    expect(result[0]).toEqual({ type: 'text', text: 'Hello' });
  });

  it('text_delta starts new text block when slot has wrong type', () => {
    const before = [{ type: 'thinking' as const, thinking: '' }];
    const result = reduceStreamEvent(before, { type: 'text_delta', contentIndex: 0, delta: 'Hello' } as any);
    expect(result[0]).toEqual({ type: 'text', text: 'Hello' });
  });

  it('thinking_start creates empty thinking block', () => {
    const result = reduceStreamEvent([], { type: 'thinking_start', contentIndex: 0 } as any);
    expect(result[0]).toEqual({ type: 'thinking', thinking: '' });
  });

  it('thinking_delta appends to existing thinking block', () => {
    const before = [{ type: 'thinking' as const, thinking: 'step' }];
    const result = reduceStreamEvent(before, { type: 'thinking_delta', contentIndex: 0, delta: ' 2' } as any);
    expect(result[0]).toEqual({ type: 'thinking', thinking: 'step 2' });
  });

  it('thinking_delta starts new block when slot has wrong type', () => {
    const result = reduceStreamEvent([undefined], { type: 'thinking_delta', contentIndex: 0, delta: 'aha' } as any);
    expect(result[0]).toEqual({ type: 'thinking', thinking: 'aha' });
  });

  it('toolcall_delta extracts toolCall from partial', () => {
    const partial = { content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: '{}' }] };
    const result = reduceStreamEvent([undefined], { type: 'toolcall_delta', contentIndex: 0, partial } as any);
    expect(result[0]).toEqual({ type: 'toolCall', id: 't1', name: 'read', arguments: '{}' });
  });

  it('toolcall_delta ignores non-toolCall content block', () => {
    const partial = { content: [{ type: 'text', text: 'nope' }] };
    const result = reduceStreamEvent([undefined], { type: 'toolcall_delta', contentIndex: 0, partial } as any);
    expect(result[0]).toBeUndefined();
  });

  it('toolcall_start has same behavior as toolcall_delta', () => {
    const partial = { content: [{ type: 'toolCall', id: 't2', name: 'ls', arguments: '[]' }] };
    const result = reduceStreamEvent([undefined], { type: 'toolcall_start', contentIndex: 0, partial } as any);
    expect(result[0]).toEqual({ type: 'toolCall', id: 't2', name: 'ls', arguments: '[]' });
  });

  it('toolcall_end sets the complete tool call', () => {
    const toolCall = { type: 'toolCall' as const, id: 't3', name: 'exec', arguments: '{}' };
    const result = reduceStreamEvent([undefined], { type: 'toolcall_end', contentIndex: 0, toolCall } as any);
    expect(result[0]).toEqual(toolCall);
  });

  it('text_end does not modify parts', () => {
    const before = [{ type: 'text' as const, text: 'done' }];
    const result = reduceStreamEvent(before, { type: 'text_end', contentIndex: 0 } as any);
    expect(result).toEqual(before);
  });

  it('thinking_end does not modify parts', () => {
    const before = [{ type: 'thinking' as const, thinking: 'done' }];
    const result = reduceStreamEvent(before, { type: 'thinking_end', contentIndex: 0 } as any);
    expect(result).toEqual(before);
  });

  it('start / done / error events are no-ops', () => {
    const before: Array<StreamingContentBlock | undefined> = [];
    expect(reduceStreamEvent(before, { type: 'start' } as any)).toEqual([]);
    expect(reduceStreamEvent(before, { type: 'done' } as any)).toEqual([]);
    expect(reduceStreamEvent(before, { type: 'error' } as any)).toEqual([]);
  });

  it('preserves parts beyond contentIndex', () => {
    const parts: Array<StreamingContentBlock | undefined> = [{ type: 'text', text: 'existing' }, undefined, { type: 'text', text: 'third' }];
    const result = reduceStreamEvent(parts, { type: 'thinking_start', contentIndex: 1 } as any);
    expect(result[0]).toEqual({ type: 'text', text: 'existing' });
    expect(result[1]).toEqual({ type: 'thinking', thinking: '' });
    expect(result[2]).toEqual({ type: 'text', text: 'third' });
  });
});

describe('compactContentBlocks', () => {
  it('filters out undefined entries', () => {
    const parts: Array<StreamingContentBlock | undefined> = [
      { type: 'text', text: 'a' }, undefined, { type: 'thinking', thinking: 'b' },
    ];
    expect(compactContentBlocks(parts)).toEqual([
      { type: 'text', text: 'a' }, { type: 'thinking', thinking: 'b' },
    ]);
  });

  it('returns empty array for all-undefined input', () => {
    expect(compactContentBlocks([undefined, undefined])).toEqual([]);
  });

  it('returns same array when no undefined', () => {
    const parts: StreamingContentBlock[] = [{ type: 'text', text: 'x' }];
    expect(compactContentBlocks(parts)).toEqual(parts);
  });
});

// ─── budget ──────────────────────────────────────────────────────

describe('IterationBudget', () => {
  it('uses default config values for missing fields', () => {
    const budget = new IterationBudget({});
    expect(budget.hasBudget()).toBe(true);
  });

  it('checkTurn increments count and returns true while within limit', () => {
    const budget = new IterationBudget({ maxTurns: 2 });
    expect(budget.checkTurn()).toBe(true);
    expect(budget.checkTurn()).toBe(true);
    expect(budget.checkTurn()).toBe(false);
  });

  it('hasBudget returns false when maxTurns reached', () => {
    const budget = new IterationBudget({ maxTurns: 1 });
    budget.checkTurn();
    expect(budget.hasBudget()).toBe(false);
  });

  it('hasBudget returns false when consecutiveErrors exceed limit', () => {
    const budget = new IterationBudget({ maxConsecutiveErrors: 2 });
    budget.recordError();
    budget.recordError();
    expect(budget.hasBudget()).toBe(false);
  });

  it('hasBudget returns false when sameToolFailures exceed limit', () => {
    const budget = new IterationBudget({ maxSameToolFailures: 2 });
    budget.recordError('tool1');
    budget.recordError('tool1');
    expect(budget.hasBudget()).toBe(false);
  });

  it('recordError without toolName only increments consecutiveErrors', () => {
    const budget = new IterationBudget({});
    budget.recordError();
    expect(budget.consecutiveErrors).toBe(1);
  });

  it('recordSuccess resets consecutiveErrors and clears tool failure count', () => {
    const budget = new IterationBudget({});
    budget.recordError('tool1');
    budget.recordSuccess('tool1');
    expect(budget.consecutiveErrors).toBe(0);
    budget.recordError('tool1');
    budget.recordError('tool1');
    budget.recordSuccess();
    expect(budget.consecutiveErrors).toBe(0);
  });

  it('getStatus computes turnsRemaining and atRisk correctly', () => {
    const budget = new IterationBudget({ maxTurns: 5, maxConsecutiveErrors: 3 });
    budget.checkTurn(); budget.checkTurn(); budget.checkTurn();
    const status = budget.getStatus();
    expect(status.turnsRemaining).toBe(2);
    expect(status.atRisk).toBe(true);
    expect(status.reason).toBeUndefined();
  });

  it('getStatus has reason when maxTurns exceeded', () => {
    const budget = new IterationBudget({ maxTurns: 0 });
    expect(budget.getStatus().reason).toBe('max_turns exceeded');
  });

  it('getStatus has reason when maxConsecutiveErrors exceeded', () => {
    const budget = new IterationBudget({ maxConsecutiveErrors: 0 });
    expect(budget.getStatus().reason).toBe('max_consecutive_errors exceeded');
  });

  it('custom maxSameToolFailures works', () => {
    const budget = new IterationBudget({ maxSameToolFailures: 3 });
    budget.recordError('t');
    budget.recordError('t');
    budget.recordError('t');
    expect(budget.hasBudget()).toBe(false);
    expect(budget.getStatus().reason).toBe('max_consecutive_errors exceeded');
  });

  it('recordSuccess without toolName only resets consecutiveErrors', () => {
    const budget = new IterationBudget({});
    budget.recordError('t');
    budget.recordSuccess(); // resets consecutiveErrors but not tool failure
    expect(budget.consecutiveErrors).toBe(0);
  });
});

// ─── token-usage ─────────────────────────────────────────────────

describe('emptyUsage', () => {
  it('returns zero-filled usage object', () => {
    const u = emptyUsage();
    expect(u.input).toBe(0);
    expect(u.output).toBe(0);
    expect(u.cacheRead).toBe(0);
    expect(u.cacheWrite).toBe(0);
    expect(u.totalTokens).toBe(0);
    expect(u.cost.input).toBe(0);
    expect(u.cost.output).toBe(0);
    expect(u.cost.total).toBe(0);
  });
});

describe('addCost', () => {
  it('sums all cost fields', () => {
    const a = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 };
    const b = { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, total: 7 };
    expect(addCost(a, b)).toEqual({ input: 4, output: 6, cacheRead: 0, cacheWrite: 0, total: 10 });
  });
});

describe('addUsage', () => {
  it('sums token fields and merges reasoning', () => {
    const a: Usage = { input: 10, output: 5, cacheRead: 1, cacheWrite: 0, totalTokens: 15, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 }, reasoning: 5 };
    const b: Usage = { input: 20, output: 10, cacheRead: 2, cacheWrite: 0, totalTokens: 30, cost: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, total: 7 } };
    expect(addUsage(a, b)).toMatchObject({ input: 30, output: 15, cacheRead: 3, totalTokens: 45, reasoning: 5 });
  });

  it('uses second reasoning when first is undefined', () => {
    const a: Usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const b: Usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, reasoning: 10 };
    expect(addUsage(a, b).reasoning).toBe(10);
  });
});

describe('computeCacheStats', () => {
  it('computes noCache as input minus cacheRead and cacheWrite', () => {
    const usage: Usage = { input: 100, output: 10, cacheRead: 30, cacheWrite: 20, totalTokens: 110, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    expect(computeCacheStats(usage)).toEqual({ cacheRead: 30, cacheWrite: 20, noCache: 50 });
  });

  it('treats undefined cacheRead/cacheWrite as 0', () => {
    const usage: Usage = { input: 100, output: 10, totalTokens: 110, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    expect(computeCacheStats(usage)).toEqual({ cacheRead: 0, cacheWrite: 0, noCache: 100 });
  });

  it('clamps noCache at 0', () => {
    const usage: Usage = { input: 10, output: 10, cacheRead: 20, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    expect(computeCacheStats(usage).noCache).toBe(0);
  });
});

describe('computeCacheRatio', () => {
  it('returns 0 when totalTokens is 0', () => {
    expect(computeCacheRatio(emptyUsage())).toBe(0);
  });

  it('returns ratio of cache tokens to total', () => {
    const usage: Usage = { input: 50, output: 10, cacheRead: 25, cacheWrite: 0, totalTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    expect(computeCacheRatio(usage)).toBe(0.25);
  });
});

describe('formatUsage', () => {
  it('formats token counts', () => {
    const usage: Usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 1500, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    expect(formatUsage(usage)).toBe('1,500 tokens (1,000 in / 500 out)');
  });
});

describe('formatCost', () => {
  it('rounds to 2 decimal places when >= 1', () => {
    expect(formatCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1.234 })).toBe('$1.23');
  });

  it('rounds to 4 decimal places when < 1', () => {
    expect(formatCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.12345 })).toBe('$0.1235');
  });

  it('handles missing total', () => {
    expect(formatCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })).toBe('$0.0000');
  });

  it('handles undefined total', () => {
    expect(formatCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as any)).toBe('$0.0000');
  });
});

describe('normalizeUsage', () => {
  it('returns emptyUsage for null/undefined', () => {
    expect(normalizeUsage(null)).toEqual(emptyUsage());
    expect(normalizeUsage(undefined)).toEqual(emptyUsage());
    expect(normalizeUsage('string')).toEqual(emptyUsage());
  });

  it('falls back to inputTokens/outputTokens', () => {
    const usage = normalizeUsage({ inputTokens: 5, outputTokens: 3 });
    expect(usage.input).toBe(5);
    expect(usage.output).toBe(3);
    expect(usage.totalTokens).toBe(8);
  });

  it('reads cache directly when provided as numbers', () => {
    const usage = normalizeUsage({ input: 10, output: 2, cacheRead: 15, cacheWrite: 10 });
    expect(usage.cacheRead).toBe(15);
    expect(usage.cacheWrite).toBe(10);
  });

  it('reads cache from inputTokenDetails', () => {
    const usage = normalizeUsage({ input: 10, output: 2, inputTokenDetails: { cacheReadTokens: 3, cacheWriteTokens: 2 } });
    expect(usage.cacheRead).toBe(3);
    expect(usage.cacheWrite).toBe(2);
  });

  it('reads reasoning directly when provided as number', () => {
    const usage = normalizeUsage({ input: 10, output: 2, reasoning: 7 });
    expect(usage.reasoning).toBe(7);
  });

  it('reads reasoning from outputTokenDetails', () => {
    const usage = normalizeUsage({ input: 10, output: 2, outputTokenDetails: { reasoningTokens: 4 } });
    expect(usage.reasoning).toBe(4);
  });

  it('uses provided totalTokens over sum', () => {
    const usage = normalizeUsage({ input: 5, output: 5, totalTokens: 20 });
    expect(usage.totalTokens).toBe(20);
  });

  it('falls back to 0 when cacheReadTokens is not a number', () => {
    const usage = normalizeUsage({ input: 10, output: 2, inputTokenDetails: { cacheReadTokens: 'nope' } });
    expect(usage.cacheRead).toBe(0);
  });

  it('falls back to 0 when cacheWriteTokens is not a number', () => {
    const usage = normalizeUsage({ input: 10, output: 2, inputTokenDetails: { cacheWriteTokens: true } });
    expect(usage.cacheWrite).toBe(0);
  });

  it('falls back to undefined when reasoningTokens is not a number', () => {
    const usage = normalizeUsage({ input: 10, output: 2, outputTokenDetails: { reasoningTokens: 'nope' } });
    expect(usage.reasoning).toBeUndefined();
  });

  it('defaults cost to zero', () => {
    const usage = normalizeUsage({});
    expect(usage.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  });
});

describe('normalizeUsageDetail', () => {
  it('fills runAt and turns', () => {
    const detail = normalizeUsageDetail({ input: 10, output: 2, runAt: new Date('2024-01-01'), turns: [{ input: 5, output: 1 }] });
    expect(detail.runAt).toEqual(new Date('2024-01-01'));
    expect(detail.turns).toHaveLength(1);
  });

  it('defaults runAt to now when missing', () => {
    const before = Date.now();
    const detail = normalizeUsageDetail({ input: 10, output: 2 });
    expect(detail.runAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('falls back turns to [base] when not an array', () => {
    const detail = normalizeUsageDetail({ input: 10, output: 2, turns: 'nope' });
    expect(detail.turns).toHaveLength(1);
    expect(detail.turns[0].input).toBe(10);
  });
});

describe('reduceTokenUsage', () => {
  it('sums totalTokens across normalized details', () => {
    expect(reduceTokenUsage([{ input: 5, output: 5, totalTokens: 10 }, { input: 3, output: 2, totalTokens: 5 }])).toBe(15);
  });
});

// ─── agent-output ────────────────────────────────────────────────

describe('buildAgentOutput', () => {
  it('returns error content when stopReason is error', () => {
    const msg: AssistantMessage = { stopReason: 'error', errorMessage: 'boom' } as any;
    expect(buildAgentOutput(msg)).toEqual({ content: 'Error: boom', completed: true });
  });

  it('defaults error message when errorMessage is missing', () => {
    const msg: AssistantMessage = { stopReason: 'error' } as any;
    expect(buildAgentOutput(msg)).toEqual({ content: 'Error: agent stream error', completed: true });
  });

  it('concatenates text content blocks', () => {
    const msg: AssistantMessage = {
      content: [{ type: 'text', text: 'Hello' }, { type: 'thinking', thinking: 'skip' }, { type: 'text', text: ' World' }],
      stopReason: 'stop',
    } as any;
    expect(buildAgentOutput(msg)).toEqual({ content: 'Hello World', completed: true });
  });

  it('returns empty string when no text blocks', () => {
    const msg: AssistantMessage = { content: [], stopReason: 'stop' } as any;
    expect(buildAgentOutput(msg)).toEqual({ content: '', completed: true });
  });

  it('returns empty string when assistant is undefined', () => {
    expect(buildAgentOutput(undefined)).toEqual({ content: '', completed: true });
  });
});

describe('buildAgentErrorOutput', () => {
  it('uses Error.message', () => {
    expect(buildAgentErrorOutput(new Error('fail'))).toEqual({ content: 'Error: fail', completed: true });
  });

  it('uses String() for non-Error', () => {
    expect(buildAgentErrorOutput('oops')).toEqual({ content: 'Error: oops', completed: true });
  });
});

describe('agentOutputErrorMessage', () => {
  it('strips "Error: " prefix', () => {
    expect(agentOutputErrorMessage({ content: 'Error: something broke', completed: true })).toBe('something broke');
  });
});

// ─── session-title ───────────────────────────────────────────────

describe('forkSessionTitleGeneration', () => {
  it('does nothing when session already has a title', () => {
    const mockTitleProvider = { generateTitle: vi.fn() };
    const di = { titleProvider: mockTitleProvider } as unknown as AgentDI;
    const session = makeSession({ metadata: { schemaVersion: 2, title: 'Existing' } });
    const emit = vi.fn();
    forkSessionTitleGeneration({ di, session, emit });
    expect(mockTitleProvider.generateTitle).not.toHaveBeenCalled();
  });

  it('emits title when generateTitle succeeds', async () => {
    const mockTitleProvider = { generateTitle: vi.fn().mockResolvedValue('New Title') };
    const di = { titleProvider: mockTitleProvider } as unknown as AgentDI;
    const session = makeSession();
    const emit = vi.fn();
    forkSessionTitleGeneration({ di, session, emit });
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'session-title', title: 'New Title' }));
  });

  it('does not emit when generateTitle returns undefined', async () => {
    const mockTitleProvider = { generateTitle: vi.fn().mockResolvedValue(undefined) };
    const di = { titleProvider: mockTitleProvider } as unknown as AgentDI;
    const session = makeSession();
    const emit = vi.fn();
    forkSessionTitleGeneration({ di, session, emit });
    await vi.waitFor(() => expect(mockTitleProvider.generateTitle).toHaveBeenCalled(), { timeout: 1000 });
    // Give it time to resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(emit).not.toHaveBeenCalled();
  });

  it('handles throw silently', async () => {
    const mockTitleProvider = { generateTitle: vi.fn().mockRejectedValue(new Error('fail')) };
    const di = { titleProvider: mockTitleProvider } as unknown as AgentDI;
    const session = makeSession();
    const emit = vi.fn();
    expect(() => forkSessionTitleGeneration({ di, session, emit })).not.toThrow();
    await vi.waitFor(() => expect(mockTitleProvider.generateTitle).toHaveBeenCalled(), { timeout: 1000 });
  });
});
