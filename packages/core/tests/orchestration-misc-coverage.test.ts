import { describe, expect, it, vi } from 'vitest';
import { ConcurrencyLimiter } from '../src/orchestration/concurrency-limiter.js';
import { BatchCompletion } from '../src/orchestration/batch-completion.js';
import { MultiAgentEventHandler, type MultiAgentEventHandlerDeps } from '../src/orchestration/multi-agent-event-handler.js';
import type { MessageDelivery, MessageDeliveryKind, MessageDeliveryStatus } from '../src/orchestration/delivery-model.js';
import type { MessageDeliveryUsecase } from '../src/orchestration/delivery-usecase.js';
import type { AgentDI } from '../src/assembly/agent-di.js';
import type { SessionUsecase } from '../src/session/session-usecase.js';
import type { AgentThreadUsecase } from '../src/session/agent-thread/agent-thread-usecase.js';
import type { Session } from '../src/session/model.js';
import type { SessionRuntime } from '../src/session/runtime.js';
import type { REMAgentEvent } from '../src/agent/agent-event.js';
import type { AgentSystemEvent } from '../src/agent/bus-events.js';
import type { DiscussionRuntime } from '../src/orchestration/discussion-runtime.js';

// ─── shared helpers ──────────────────────────────────────────────

function makeDelivery(overrides: Partial<MessageDelivery> = {}): MessageDelivery {
  return {
    deliveryId: 'd1', sessionId: 's1', kind: 'message' as MessageDeliveryKind, batchId: 'b1',
    messageId: 'm1', rootUserMessageId: 'r1', targetAgentThreadId: 't1',
    requestedByAgentThreadId: 'req1', status: 'completed' as MessageDeliveryStatus,
    attempt: 0, depth: 1, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

// ─── concurrency-limiter ─────────────────────────────────────────

describe('ConcurrencyLimiter', () => {
  it('throws when limit is not positive', () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow('positive');
    expect(() => new ConcurrencyLimiter(-1)).toThrow('positive');
    expect(() => new ConcurrencyLimiter(1.5)).toThrow('positive');
  });

  it('runs operations within limit', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const results: number[] = [];
    const op = async (id: number) => {
      results.push(id);
      return id;
    };
    await Promise.all([limiter.run(() => op(1)), limiter.run(() => op(2))]);
    expect(results).toHaveLength(2);
  });

  it('limits concurrency by queuing excess', async () => {
    const limiter = new ConcurrencyLimiter(1);
    let concurrent = 0;
    let maxConcurrent = 0;
    const ops = [1, 2, 3].map(async (_i) => {
      await limiter.run(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      });
    });
    await Promise.all(ops);
    expect(maxConcurrent).toBe(1);
  });

  it('releases slot even on operation error', async () => {
    const limiter = new ConcurrencyLimiter(1);
    try {
      await limiter.run(async () => {
        throw new Error('fail');
      });
    } catch {}
    // Should not hang — slot was released
    const result = await limiter.run(async () => 'ok');
    expect(result).toBe('ok');
  });
});

// ─── batch-completion ────────────────────────────────────────────

describe('BatchCompletion', () => {

  it('skips when delivery is not a message', async () => {
    const deliveries = { listByRoot: vi.fn(), createBatch: vi.fn() } as unknown as MessageDeliveryUsecase;
    const completion = new BatchCompletion(deliveries);
    const delivery = makeDelivery({ kind: 'resume' as MessageDeliveryKind });
    await completion.createResumeIfComplete(delivery);
    expect(deliveries.listByRoot).not.toHaveBeenCalled();
  });

  it('skips when no requestedByAgentThreadId', async () => {
    const deliveries = { listByRoot: vi.fn(), createBatch: vi.fn() } as unknown as MessageDeliveryUsecase;
    const completion = new BatchCompletion(deliveries);
    const delivery = makeDelivery({ requestedByAgentThreadId: undefined });
    await completion.createResumeIfComplete(delivery);
    expect(deliveries.listByRoot).not.toHaveBeenCalled();
  });

  it('skips when batch has non-terminal statuses', async () => {
    const deliveries = {
      listByRoot: vi.fn().mockResolvedValue([
        makeDelivery({ status: 'completed' as MessageDeliveryStatus }),
        makeDelivery({ status: 'queued' as MessageDeliveryStatus, deliveryId: 'd2' }),
      ]),
      createBatch: vi.fn(),
    } as unknown as MessageDeliveryUsecase;
    const completion = new BatchCompletion(deliveries);
    await completion.createResumeIfComplete(makeDelivery());
    expect(deliveries.createBatch).not.toHaveBeenCalled();
  });

  it('creates resume when all batch deliveries are terminal', async () => {
    const deliveries = {
      listByRoot: vi.fn().mockResolvedValue([
        makeDelivery({ status: 'completed' as MessageDeliveryStatus }),
        makeDelivery({ status: 'failed' as MessageDeliveryStatus, deliveryId: 'd2' }),
      ]),
      createBatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageDeliveryUsecase;
    const completion = new BatchCompletion(deliveries);
    await completion.createResumeIfComplete(makeDelivery());
    expect(deliveries.createBatch).toHaveBeenCalledTimes(1);
    const batch = (deliveries.createBatch as any).mock.calls[0][0];
    expect(batch[0].kind).toBe('resume');
  });

  it('skips when batch is empty', async () => {
    const deliveries = {
      listByRoot: vi.fn().mockResolvedValue([]),
      createBatch: vi.fn(),
    } as unknown as MessageDeliveryUsecase;
    const completion = new BatchCompletion(deliveries);
    await completion.createResumeIfComplete(makeDelivery());
    expect(deliveries.createBatch).not.toHaveBeenCalled();
  });

  it('swallows unique constraint errors', async () => {
    const error = new Error('unique constraint violation');
    const deliveries = {
      listByRoot: vi.fn().mockResolvedValue([makeDelivery({ status: 'completed' as MessageDeliveryStatus })]),
      createBatch: vi.fn().mockRejectedValue(error),
    } as unknown as MessageDeliveryUsecase;
    const completion = new BatchCompletion(deliveries);
    await expect(completion.createResumeIfComplete(makeDelivery())).resolves.toBeUndefined();
  });

  it('re-throws non-unique-constraint errors', async () => {
    const error = new Error('other error');
    const deliveries = {
      listByRoot: vi.fn().mockResolvedValue([makeDelivery({ status: 'completed' as MessageDeliveryStatus })]),
      createBatch: vi.fn().mockRejectedValue(error),
    } as unknown as MessageDeliveryUsecase;
    const completion = new BatchCompletion(deliveries);
    await expect(completion.createResumeIfComplete(makeDelivery())).rejects.toThrow('other error');
  });
});

// ─── multi-agent-event-handler ───────────────────────────────────

describe('MultiAgentEventHandler', () => {
  function createDeps(overrides: Partial<MultiAgentEventHandlerDeps> = {}): MultiAgentEventHandlerDeps {
    const sessionUsecase = {
      persistAgentEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionUsecase;
    const threadUsecase = {
      get: vi.fn().mockResolvedValue({}),
      listBySession: vi.fn().mockResolvedValue([]),
    } as unknown as AgentThreadUsecase;
    const deliveries = {
      createBatch: vi.fn().mockResolvedValue(undefined),
      listByRoot: vi.fn().mockResolvedValue([]),
      interruptRoot: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageDeliveryUsecase;
    const di = {
      sessionProvider: { appendMessage: vi.fn().mockResolvedValue(undefined) },
      configProvider: { resolveAgent: vi.fn().mockReturnValue({}) },
      models: { getModel: vi.fn().mockReturnValue(null) },
    } as unknown as AgentDI;
    return {
      di, sessionUsecase, threadUsecase, deliveries, publish: vi.fn(),
      ...overrides,
    };
  }

  function makeRuntime(overrides: Partial<SessionRuntime> = {}): SessionRuntime {
    return {
      sessionId: 's1', workspace: 'ws', threadRuntimes: new Map(),
      activeDiscussion: {
        budget: { recordTokens: vi.fn() },
        rootUserMessageId: 'r1',
        status: 'running' as const,
      },
      ...overrides as any,
    } as unknown as SessionRuntime;
  }

  it('handles message-persist event', async () => {
    const deps = createDeps();
    const handler = new MultiAgentEventHandler(deps);
    const event: REMAgentEvent = { type: 'message-persist', message: {} as any, messageId: 'm1' };
    await handler.handle(makeRuntime(), 't1', event);
    expect(deps.sessionUsecase.persistAgentEvent).toHaveBeenCalledWith('s1', 't1', event);
  });

  it('handles usage event and publishes usage-change', async () => {
    const deps = createDeps();
    const handler = new MultiAgentEventHandler(deps);
    const event: REMAgentEvent = { type: 'usage', usage: { totalTokens: 10, input: 5, output: 5, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    await handler.handle(makeRuntime(), 't1', event);
    expect(deps.sessionUsecase.persistAgentEvent).toHaveBeenCalledWith('s1', 't1', event);
    expect(deps.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'usage-change' }));
  });

  it('handles todo-updated event', async () => {
    const deps = createDeps();
    const handler = new MultiAgentEventHandler(deps);
    const event: REMAgentEvent = { type: 'todo-updated', sessionId: 's1', todos: [] };
    await handler.handle(makeRuntime(), 't1', event);
    expect(deps.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'todo-updated' }));
  });

  it('handles session-title event', async () => {
    const deps = createDeps();
    const handler = new MultiAgentEventHandler(deps);
    const event: REMAgentEvent = { type: 'session-title', title: 'New Title' };
    await handler.handle(makeRuntime(), 't1', event);
    expect(deps.sessionUsecase.persistAgentEvent).toHaveBeenCalled();
  });

  it('handles compress-end event', async () => {
    const deps = createDeps();
    const handler = new MultiAgentEventHandler(deps);
    const event: REMAgentEvent = { type: 'compress-end', sessionId: 's1', archiveId: 'a1', removedMessageCount: 5 };
    await handler.handle(makeRuntime(), 't1', event);
    expect(deps.sessionUsecase.persistAgentEvent).toHaveBeenCalled();
  });

  it('throws on error event', async () => {
    const deps = createDeps();
    const handler = new MultiAgentEventHandler(deps);
    const error = new Error('test error');
    const event: REMAgentEvent = { type: 'error', error: { name: 'Error', message: 'test error' } };
    await expect(handler.handle(makeRuntime(), 't1', event)).rejects.toThrow();
  });

  it('publishes chunk events', async () => {
    const deps = createDeps();
    const handler = new MultiAgentEventHandler(deps);
    const runtime = makeRuntime();
    const threadRuntime = { agent: { agentId: 'a1' } };
    runtime.threadRuntimes.set('t1', threadRuntime as any);
    const event: REMAgentEvent = { type: 'compress-start', sessionId: 's1', estimatedTokens: 100, threshold: 200 };
    await handler.handle(runtime, 't1', event);
    expect(deps.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'chunk' }));
  });

  it('handleFailure interrupts root for organizer failure', async () => {
    const deps = createDeps();
    deps.threadUsecase.get = vi.fn().mockResolvedValue({
      agentThreadId: 't-org', sessionId: 's1', role: 'organizer',
    });
    const handler = new MultiAgentEventHandler(deps);
    const session = { sessionId: 's1', conversation: [], currentTurn: 0, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const delivery = makeDelivery({ targetAgentThreadId: 't-org' });
    const discussion = { rootUserMessageId: 'r1', status: 'running' as const } as unknown as DiscussionRuntime;
    await handler.handleFailure(session, delivery, new Error('fail'), discussion);
    expect(discussion.status).toBe('failed');
    expect(deps.deliveries.interruptRoot).toHaveBeenCalled();
  });

  it('handleFailure creates synthetic failure message for member', async () => {
    const deps = createDeps();
    deps.threadUsecase.get = vi.fn().mockResolvedValue({
      agentThreadId: 't-member', sessionId: 's1', role: 'member', agentId: 'agent1',
      lifecycle: 'persistent',
    });
    // provide a valid model for createCommunicationMessage
    const mockModel = {
      provider: 'mock', name: 'mock-model', api: 'openai-completions', reasoning: false,
      input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000, maxTokens: 4096,
    };
    const mockConfig = {
      resolveAgent: vi.fn().mockReturnValue({ id: 'agent1', corePrompt: '' }),
      getModelConfig: vi.fn().mockReturnValue({ provider: 'mock', model: 'mock-model', apiKey: 'key' }),
    };
    (deps.di as any).models = { getModel: vi.fn().mockReturnValue(mockModel) };
    (deps.di as any).configProvider = mockConfig;

    const handler = new MultiAgentEventHandler(deps);
    const session = { sessionId: 's1', conversation: [], currentTurn: 0, metadata: { workspace: 'ws' }, createdAt: new Date(), updatedAt: new Date() };
    const delivery = makeDelivery({ targetAgentThreadId: 't-member' });
    const discussion = { rootUserMessageId: 'r1', status: 'running' as const, budget: { recordMessage: vi.fn() } } as unknown as DiscussionRuntime;
    await handler.handleFailure(session, delivery, new Error('member fail'), discussion);
    expect(deps.di.sessionProvider.appendMessage).toHaveBeenCalled();
    expect(discussion.budget.recordMessage).toHaveBeenCalled();
  });

  it('handleFailure throws when thread not found', async () => {
    const deps = createDeps();
    deps.threadUsecase.get = vi.fn().mockResolvedValue(null);
    const handler = new MultiAgentEventHandler(deps);
    const session = { sessionId: 's1', conversation: [], currentTurn: 0, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const delivery = makeDelivery({ targetAgentThreadId: 't-no' });
    const discussion = { rootUserMessageId: 'r1' } as unknown as DiscussionRuntime;
    await expect(handler.handleFailure(session, delivery, new Error('fail'), discussion)).rejects.toThrow('AgentThread not found');
  });

  it('handleFailure throws when thread sessionId mismatches', async () => {
    const deps = createDeps();
    deps.threadUsecase.get = vi.fn().mockResolvedValue({
      agentThreadId: 't-org', sessionId: 'wrong', role: 'organizer',
    });
    const handler = new MultiAgentEventHandler(deps);
    const session = { sessionId: 's1', conversation: [], currentTurn: 0, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const delivery = makeDelivery({ targetAgentThreadId: 't-org' });
    const discussion = { rootUserMessageId: 'r1' } as unknown as DiscussionRuntime;
    await expect(handler.handleFailure(session, delivery, new Error('fail'), discussion)).rejects.toThrow('AgentThread not found');
  });
});
