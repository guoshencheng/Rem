import { describe, expect, it, vi } from 'vitest';
import { archiveConversation } from '../src/runtime/conversation-archive.js';
import { createCompressionTransform } from '../src/runtime/compression-transform.js';
import { PendingMessageQueue } from '../src/runtime/pending-queue.js';
import { generate } from '../src/runtime/generation/generate.js';
import type { ArchiveRecord, ArchiveStore } from '../src/sdk/storage-provider.js';
import type { ContextCompressor } from '../src/sdk/compressor.js';
import type { AgentStreamEvent } from '../src/agent/types.js';
import type { Message } from '@earendil-works/pi-ai';
import type { ErrorHandler, ErrorCategory } from '../src/sdk/error-handler.js';
import { createMockModels } from './helpers/mock-models.js';

// ─── conversation-archive ────────────────────────────────────────

describe('archiveConversation', () => {
  it('saves archive record with correct fields', async () => {
    const savedRecords: ArchiveRecord[] = [];
    const store: ArchiveStore = {
      save: vi.fn().mockImplementation(async (r: ArchiveRecord) => { savedRecords.push(r); }),
      get: vi.fn().mockResolvedValue(null),
      listBySession: vi.fn().mockResolvedValue([]),
      getLatest: vi.fn().mockResolvedValue(null),
    };
    const messages: Message[] = [
      { role: 'user', content: 'hello', timestamp: 1 } as Message,
      { role: 'assistant', content: 'hi', timestamp: 2 } as Message,
    ];
    const archiveId = await archiveConversation(store, 's-1', messages);
    expect(archiveId).toBeDefined();
    expect(store.save).toHaveBeenCalledTimes(1);
    const record = savedRecords[0];
    expect(record.sessionId).toBe('s-1');
    expect(record.conversationSnapshot).toEqual(messages);
    expect(record.version).toBe(1);
    expect(record.parentArchiveId).toBeUndefined();
  });

  it('increments version from previous archive', async () => {
    const prevRecord: ArchiveRecord = {
      id: 'prev', sessionId: 's-1', compressedAt: new Date(), version: 3,
      conversationSnapshot: [], summary: '',
    };
    const store: ArchiveStore = {
      save: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      listBySession: vi.fn().mockResolvedValue([]),
      getLatest: vi.fn().mockResolvedValue(prevRecord),
    };
    const messages: Message[] = [{ role: 'user', content: 'x', timestamp: 1 } as Message];
    await archiveConversation(store, 's-1', messages);
    const saved = (store.save as any).mock.calls[0][0];
    expect(saved.version).toBe(4);
    expect(saved.parentArchiveId).toBe('prev');
  });
});

// ─── compression-transform ───────────────────────────────────────

describe('createCompressionTransform', () => {
  function createMockCompressor(): ContextCompressor {
    return {
      compress: vi.fn().mockImplementation(async (msgs: Message[]) => msgs.slice(0, 2)),
    };
  }

  const baseMessages: Message[] = [
    { role: 'user', content: '1', timestamp: 1 } as Message,
    { role: 'assistant', content: '2', timestamp: 2 } as Message,
    { role: 'user', content: '3', timestamp: 3 } as Message,
    { role: 'assistant', content: '4', timestamp: 4 } as Message,
  ];

  it('compresses when shouldCompress returns true', async () => {
    const compressor = createMockCompressor();
    const emit = vi.fn();
    const archive = vi.fn().mockResolvedValue('a-id');
    const transform = createCompressionTransform({
      compressor,
      shouldCompress: () => true,
      estimatedTokens: () => 1000,
      threshold: () => 800,
      archive,
      emit,
      sessionId: 's-1',
    });
    const result = await transform(baseMessages);
    expect(result.length).toBeLessThan(baseMessages.length);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'compress-start' }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'compress-end' }));
    expect(archive).toHaveBeenCalled();
  });

  it('does not compress when shouldCompress returns false', async () => {
    const compressor = createMockCompressor();
    const emit = vi.fn();
    const transform = createCompressionTransform({
      compressor,
      shouldCompress: () => false,
      estimatedTokens: () => 100,
      threshold: () => 200,
      archive: vi.fn(),
      emit,
      sessionId: 's-1',
    });
    const result = await transform(baseMessages);
    expect(result).toEqual(baseMessages);
    expect(emit).not.toHaveBeenCalled();
  });

  it('appends new messages to compressed base on subsequent calls', async () => {
    const compressor = createMockCompressor();
    const emit = vi.fn();
    const archive = vi.fn().mockResolvedValue('a-id');
    const transform = createCompressionTransform({
      compressor,
      shouldCompress: () => true,
      estimatedTokens: () => 100,
      threshold: () => 50,
      archive,
      emit,
      sessionId: 's-1',
    });
    await transform(baseMessages);
    const newMessages: Message[] = [
      { role: 'user', content: '5', timestamp: 5 } as Message,
      { role: 'assistant', content: '6', timestamp: 6 } as Message,
    ];
    const result = await transform([...baseMessages, ...newMessages]);
    // Should be compressed base + only the new messages
    expect(result.length).toBe(4); // 2 compressed + 2 new
  });
});

// ─── pending-queue ────────────────────────────────────────────────

describe('PendingMessageQueue', () => {
  const msg = (role: string): Message => ({ role, content: 'x', timestamp: 1 } as unknown as Message);

  it('enqueues and checks items', () => {
    const q = new PendingMessageQueue('single');
    expect(q.hasItems()).toBe(false);
    q.enqueue(msg('user'));
    expect(q.hasItems()).toBe(true);
  });

  it('drains one at a time in single mode', () => {
    const q = new PendingMessageQueue('single');
    q.enqueue(msg('a')); q.enqueue(msg('b'));
    expect(q.drain()).toEqual([msg('a')]);
    expect(q.hasItems()).toBe(true);
    expect(q.drain()).toEqual([msg('b')]);
    expect(q.hasItems()).toBe(false);
  });

  it('drains all at once in all mode', () => {
    const q = new PendingMessageQueue('all');
    q.enqueue(msg('a')); q.enqueue(msg('b'));
    expect(q.drain()).toEqual([msg('a'), msg('b')]);
    expect(q.hasItems()).toBe(false);
  });

  it('drain returns empty when no items', () => {
    const q = new PendingMessageQueue('single');
    expect(q.drain()).toEqual([]);
  });

  it('clear empties the queue', () => {
    const q = new PendingMessageQueue('all');
    q.enqueue(msg('a'));
    q.clear();
    expect(q.hasItems()).toBe(false);
  });

  it('mode is accessible', () => {
    const q = new PendingMessageQueue('all');
    expect(q.mode).toBe('all');
  });
});

// ─── generate ─────────────────────────────────────────────────────

class FakeErrorHandler implements ErrorHandler {
  classifyCalls: unknown[] = [];
  retryable = true;

  classify(error: unknown): ErrorCategory {
    this.classifyCalls.push(error);
    return 'api_error';
  }
  isRetryable(_: ErrorCategory): boolean {
    return this.retryable;
  }
  getRetryInstruction(_: ErrorCategory): string | undefined {
    return undefined;
  }
}

describe('generate', () => {
  it('throws when model is not found', async () => {
    const models = createMockModels();
    await expect(generate({
      models,
      provider: 'unknown',
      model: 'no-model',
      system: 'test',
      messages: [],
    })).rejects.toThrow('Unknown model');
  });

  it('returns assistant message on success', async () => {
    const models = createMockModels({ name: 'mock' });
    const result = await generate({
      models,
      provider: 'mock',
      model: 'mock-model',
      system: 'test',
      messages: [],
    });
    expect(result.role).toBe('assistant');
  });

  it('retries on retryable errors with errorHandler', async () => {
    const models = createMockModels({
      name: 'mock',
      complete: () => {
        throw new Error('api error');
      },
    });
    const errorHandler = new FakeErrorHandler();
    await expect(generate({
      models,
      provider: 'mock',
      model: 'mock-model',
      system: 'test',
      messages: [],
      errorHandler,
    })).rejects.toThrow('api error');
    // Should have been retried
    expect(errorHandler.classifyCalls.length).toBe(3); // maxAttempts = 3
  });

  it('does not retry when errorHandler is not provided', async () => {
    const models = createMockModels({
      name: 'mock',
      complete: () => {
        throw new Error('fail');
      },
    });
    await expect(generate({
      models,
      provider: 'mock',
      model: 'mock-model',
      system: 'test',
      messages: [],
    })).rejects.toThrow('fail');
  });

  it('does not retry non-retryable errors', async () => {
    const models = createMockModels({
      name: 'mock',
      complete: () => {
        throw new Error('fatal');
      },
    });
    const errorHandler = new FakeErrorHandler();
    errorHandler.retryable = false;
    await expect(generate({
      models,
      provider: 'mock',
      model: 'mock-model',
      system: 'test',
      messages: [],
      errorHandler,
    })).rejects.toThrow('fatal');
    // Only called once since it's not retryable
    expect(errorHandler.classifyCalls.length).toBe(1);
  });

  it('passes tools and other options to complete without error', async () => {
    const models = createMockModels({ name: 'mock' });
    const result = await generate({
      models,
      provider: 'mock',
      model: 'mock-model',
      system: 'sys',
      messages: [],
      tools: [{ name: 't1', description: 'd', parameters: {} }],
      reasoning: 'low',
    });
    expect(result.role).toBe('assistant');
  });

  it('passes responseFormat without error', async () => {
    const models = createMockModels({ name: 'mock' });
    const result = await generate({
      models,
      provider: 'mock',
      model: 'mock-model',
      system: 'sys',
      messages: [],
      responseFormat: { type: 'json_object' },
    });
    expect(result.role).toBe('assistant');
  });
});
