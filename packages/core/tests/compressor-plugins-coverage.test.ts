import { describe, expect, it } from 'vitest';
import { splitHeadTail } from '../src/plugins/compressor/llm-summary/split.js';
import {
  buildSummaryPrompt,
  formatSummaryAsMarkdown,
  SUMMARY_SYSTEM_PROMPT,
  SUMMARY_TOOL_NAME,
  SUMMARY_TOOL,
} from '../src/plugins/compressor/llm-summary/prompt.js';
import type { SummaryData } from '../src/plugins/compressor/llm-summary/prompt.js';
import { LLMSummarizingCompressor } from '../src/plugins/compressor/llm-summary/index.js';
import { FixedBudgetPolicy } from '../src/plugins/budget/fixed/index.js';
import { SimpleErrorHandler } from '../src/plugins/error/simple/index.js';
import { UnsupportedSessionSchemaError } from '../src/plugins/session/errors.js';
import { EmptySkillProvider } from '../src/plugins/skill/empty/index.js';
import type { Session } from '../src/session/model.js';
import type { Message, AssistantMessage } from '@earendil-works/pi-ai';
import type { ResolvedModelConfig } from '../src/sdk/config-provider.js';
import { createMockModels, createMockProvider } from './helpers/mock-models.js';
import { createCoreModels } from 'rem-agent-core';
import type { Skill } from '../src/sdk/skill-provider.js';

/* ── helpers ── */

function makeMsg(role: 'user' | 'assistant', text: string, timestamp = 1000): Message {
  return {
    role,
    content: [{ type: 'text', text }],
    timestamp,
  } as unknown as Message;
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'test-session',
    conversation: [],
    currentTurn: 0,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/* ── llm-summary/split ── */

describe('splitHeadTail', () => {
  const messages: Message[] = [
    makeMsg('user', 'm1'), makeMsg('user', 'm2'), makeMsg('user', 'm3'),
    makeMsg('user', 'm4'), makeMsg('user', 'm5'), makeMsg('user', 'm6'),
  ];

  it('splits head and tail', () => {
    const r = splitHeadTail(messages, 2, 2);
    expect(r.head.map((m) => (m.content as any[])[0].text)).toEqual(['m1', 'm2']);
    expect(r.middle.map((m) => (m.content as any[])[0].text)).toEqual(['m3', 'm4']);
    expect(r.tail.map((m) => (m.content as any[])[0].text)).toEqual(['m5', 'm6']);
  });

  it('protecting everything returns empty middle', () => {
    const r = splitHeadTail(messages, 100, 0);
    expect(r.head).toEqual(messages);
    expect(r.middle).toEqual([]);
    expect(r.tail).toEqual([]);
  });

  it('protectHead + protectTail > length returns all in head', () => {
    const r = splitHeadTail(messages, 4, 3);
    expect(r.head).toEqual(messages);
    expect(r.middle).toEqual([]);
    expect(r.tail).toEqual([]);
  });

  it('protect 0 on both sides', () => {
    const r = splitHeadTail(messages, 0, 0);
    expect(r.head).toEqual([]);
    expect(r.middle).toEqual(messages);
    expect(r.tail).toEqual([]);
  });

  it('empty messages', () => {
    const r = splitHeadTail([], 1, 1);
    expect(r.head).toEqual([]);
    expect(r.middle).toEqual([]);
    expect(r.tail).toEqual([]);
  });
});

/* ── llm-summary/prompt ── */

describe('prompt', () => {
  describe('SUMMARY_TOOL', () => {
    it('has correct name', () => {
      expect(SUMMARY_TOOL.name).toBe(SUMMARY_TOOL_NAME);
    });

    it('has all required fields in parameters', () => {
      const required = (SUMMARY_TOOL.parameters as any).required;
      expect(required).toContain('objective');
      expect(required).toContain('importantDetails');
      expect(required).toContain('completed');
      expect(required).toContain('active');
      expect(required).toContain('blocked');
      expect(required).toContain('nextMove');
      expect(required).toContain('relevantFiles');
    });
  });

  describe('buildSummaryPrompt', () => {
    it('contains tool name and serialized messages (user role)', () => {
      const p = buildSummaryPrompt([makeMsg('user', 'hello world')]);
      expect(p).toContain(SUMMARY_TOOL_NAME);
      expect(p).toContain('hello world');
      expect(p).toContain('[User]');
    });

    it('serializes assistant role', () => {
      const p = buildSummaryPrompt([makeMsg('assistant', 'response')]);
      expect(p).toContain('[Assistant]');
    });

    it('serializes tool role', () => {
      const toolMsg: Message = {
        role: 'tool',
        content: [{ type: 'text', text: 'tool output' }],
        timestamp: 1000,
      } as unknown as Message;
      const p = buildSummaryPrompt([toolMsg]);
      expect(p).toContain('[Tool]');
    });
  });

  describe('formatSummaryAsMarkdown', () => {
    const data: SummaryData = {
      objective: 'Build a web app',
      importantDetails: ['Use React', 'TypeScript only'],
      completed: ['Setup project', 'Installed deps'],
      active: ['Building component'],
      blocked: ['Need API key'],
      nextMove: ['Finish component', 'Add tests'],
      relevantFiles: ['src/App.tsx', 'package.json'],
    };

    it('formats all sections as markdown', () => {
      const md = formatSummaryAsMarkdown(data);
      expect(md).toContain('## Objective');
      expect(md).toContain('- Build a web app');
      expect(md).toContain('## Important Details');
      expect(md).toContain('- Use React');
      expect(md).toContain('- TypeScript only');
      expect(md).toContain('## Work State');
      expect(md).toContain('### Completed');
      expect(md).toContain('- Setup project');
      expect(md).toContain('### Active');
      expect(md).toContain('- Building component');
      expect(md).toContain('### Blocked');
      expect(md).toContain('- Need API key');
      expect(md).toContain('## Next Move');
      expect(md).toContain('1. Finish component');
      expect(md).toContain('2. Add tests');
      expect(md).toContain('## Relevant Files');
      expect(md).toContain('- src/App.tsx');
      expect(md).toContain('- package.json');
    });

    it('handles empty arrays', () => {
      const empty: SummaryData = {
        objective: 'Nothing',
        importantDetails: [],
        completed: [],
        active: [],
        blocked: [],
        nextMove: [],
        relevantFiles: [],
      };
      const md = formatSummaryAsMarkdown(empty);
      expect(md).toContain('- Nothing');
      expect(md).not.toContain('### Completed\n-');
    });
  });

  describe('SUMMARY_SYSTEM_PROMPT', () => {
    it('is non-empty', () => {
      expect(SUMMARY_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });
  });
});

/* ── llm-summary/index ── */

function makeCompressorModels(opts?: {
  complete?: () => Promise<AssistantMessage>;
}): ReturnType<typeof createCoreModels> {
  const models = createCoreModels();
  models.setProvider(
    createMockProvider({ name: 'mock-comp', complete: opts?.complete }),
  );
  return models;
}

function makeToolCallMsg(summaryData: SummaryData): AssistantMessage {
  return {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'mock-comp',
    model: 'mock-model',
    content: [
      { type: 'toolCall', id: 'tc-1', name: 'submit_summary', arguments: summaryData },
    ],
    usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as unknown as AssistantMessage;
}

function makeTextMsg(text: string): AssistantMessage {
  return {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'mock-comp',
    model: 'mock-model',
    content: [{ type: 'text', text }],
    usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as unknown as AssistantMessage;
}

describe('LLMSummarizingCompressor', () => {
  const defaultConfig = {
    enabled: true,
    thresholdRatio: 0.8,
    protectHead: 2,
    protectTail: 2,
  } as Required<import('../src/sdk/config-provider.js').CompressionConfig>;

  const modelConfig: ResolvedModelConfig = {
    provider: 'mock-comp',
    model: 'mock-model',
    apiKey: 'fake-key',
  };

  const models = makeCompressorModels();

  it('shouldCompress returns false when disabled', () => {
    const comp = new LLMSummarizingCompressor(
      { ...defaultConfig, enabled: false },
      modelConfig,
      models,
    );
    expect(comp.shouldCompress(makeSession())).toBe(false);
  });

  it('shouldCompress returns true when token accumulation exceeds threshold', () => {
    const comp = new LLMSummarizingCompressor(
      { ...defaultConfig, thresholdRatio: 0.001 },
      modelConfig,
      models,
      {},
    );
    const session = makeSession({
      metadata: {
        tokenUsageHistory: [{ totalTokens: 50000, timestamp: Date.now() }],
      },
    });
    expect(comp.shouldCompress(session)).toBe(true);
  });

  it('shouldCompress returns false when effectiveTokens below threshold', () => {
    const comp = new LLMSummarizingCompressor(
      { ...defaultConfig, thresholdRatio: 0.001 },
      modelConfig,
      models,
      {},
    );
    const session = makeSession({
      metadata: {
        tokenUsageHistory: [{ totalTokens: 50000, timestamp: Date.now() }],
        compressionTokenOffset: 50000,
      },
    });
    expect(comp.shouldCompress(session)).toBe(false);
  });

  it('shouldCompress uses char estimation when no token history (above threshold)', () => {
    const comp = new LLMSummarizingCompressor(
      { ...defaultConfig, thresholdRatio: 0.001 },
      modelConfig,
      models,
      {},
    );
    const longText = 'x'.repeat(5000);
    const session = makeSession({
      conversation: [makeMsg('user', longText)],
    });
    expect(comp.shouldCompress(session)).toBe(true);
  });

  it('shouldCompress uses char estimation when no token history (below threshold)', () => {
    const comp = new LLMSummarizingCompressor(
      { ...defaultConfig, thresholdRatio: 0.999 },
      modelConfig,
      models,
      {},
    );
    const session = makeSession({
      conversation: [makeMsg('user', 'short')],
    });
    // estimated tokens = ceil(5/4) = 2, threshold = 1000000 * 0.999 ≈ 999000, 2 < 999000 → false
    expect(comp.shouldCompress(session)).toBe(false);
  });

  it('compress returns unchanged when middle is empty', async () => {
    const comp = new LLMSummarizingCompressor(
      { ...defaultConfig, protectHead: 10, protectTail: 10 },
      modelConfig,
      models,
    );
    const msgs = [makeMsg('user', 'hello')];
    const result = await comp.compress(msgs);
    expect(result).toEqual(msgs);
  });

  it('compress generates summary from tool call', async () => {
    const compModels = makeCompressorModels({
      complete: async () =>
        makeToolCallMsg({
          objective: 'Build a web app',
          importantDetails: ['Use React'],
          completed: ['Setup'],
          active: ['Building'],
          blocked: [],
          nextMove: ['Deploy'],
          relevantFiles: ['src/App.tsx'],
        }),
    });
    const comp = new LLMSummarizingCompressor(
      { ...defaultConfig, protectHead: 1, protectTail: 1 },
      modelConfig,
      compModels,
    );
    const msgs = [
      makeMsg('user', 'm1'),
      makeMsg('assistant', 'm2'),
      makeMsg('user', 'm3'),
    ];
    const result = await comp.compress(msgs);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(msgs[0]); // head
    expect(result[2]).toEqual(msgs[2]); // tail
    const summaryContent = result[1].content as any[];
    expect(summaryContent[0].text).toContain('[上下文压缩摘要]');
    expect(summaryContent[0].text).toContain('Build a web app');
  });

  it('compress falls back to text content when no tool call', async () => {
    const compModels = makeCompressorModels({
      complete: async () => makeTextMsg('Summary text from LLM'),
    });
    const comp = new LLMSummarizingCompressor(
      { ...defaultConfig, protectHead: 1, protectTail: 0 },
      modelConfig,
      compModels,
    );
    const msgs = [
      makeMsg('user', 'm1'),
      makeMsg('assistant', 'm2'),
    ];
    const result = await comp.compress(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(msgs[0]);
    const summaryContent = result[1].content as any[];
    expect(summaryContent[0].text).toContain('[上下文压缩摘要]');
    expect(summaryContent[0].text).toContain('Summary text from LLM');
  });
});

/* ── budget/fixed/index ── */

describe('FixedBudgetPolicy', () => {
  it('checkTimeout returns true when within timeout', () => {
    const policy = new FixedBudgetPolicy({} as any);
    expect(policy.checkTimeout(Date.now())).toBe(true);
  });

  it('checkTimeout returns false when timeout exceeded', () => {
    const policy = new FixedBudgetPolicy({} as any);
    // 300_000 ms ago (5 min)
    expect(policy.checkTimeout(Date.now() - 300_001)).toBe(false);
  });
});

/* ── error/simple/index ── */

describe('SimpleErrorHandler', () => {
  const handler = new SimpleErrorHandler();

  describe('classify', () => {
    it('returns api_error for name=APIError', () => {
      class APIError extends Error {
        name = 'APIError';
        status = 429;
      }
      expect(handler.classify(new APIError('rate limit'))).toBe('api_error');
    });

    it('returns api_error for errors with status number', () => {
      class HttpError extends Error {
        name = 'HttpError';
        status = 500;
      }
      expect(handler.classify(new HttpError('server error'))).toBe('api_error');
    });

    it('returns unknown for regular Error', () => {
      expect(handler.classify(new Error('something'))).toBe('unknown');
    });

    it('returns unknown for non-Error objects', () => {
      expect(handler.classify('plain string')).toBe('unknown');
    });

    it('returns unknown for null/undefined', () => {
      expect(handler.classify(null)).toBe('unknown');
      expect(handler.classify(undefined)).toBe('unknown');
    });

    it('returns unknown for error-like object without status', () => {
      class PlainError extends Error {
        name = 'SomeError';
      }
      expect(handler.classify(new PlainError('msg'))).toBe('unknown');
    });
  });

  describe('isRetryable', () => {
    it('api_error is retryable', () => {
      expect(handler.isRetryable('api_error')).toBe(true);
    });

    it('other categories are not retryable', () => {
      expect(handler.isRetryable('unknown')).toBe(false);
      expect(handler.isRetryable('timeout')).toBe(false);
      expect(handler.isRetryable('tool_error')).toBe(false);
      expect(handler.isRetryable('empty_response')).toBe(false);
    });
  });

  describe('getRetryInstruction', () => {
    it('always returns undefined', () => {
      expect(handler.getRetryInstruction('api_error')).toBeUndefined();
      expect(handler.getRetryInstruction('unknown')).toBeUndefined();
    });
  });
});

/* ── session/errors ── */

describe('UnsupportedSessionSchemaError', () => {
  it('carries schemaVersion and sessionId', () => {
    const err = new UnsupportedSessionSchemaError(2, 'sess-123');
    expect(err.name).toBe('UnsupportedSessionSchemaError');
    expect(err.schemaVersion).toBe(2);
    expect(err.message).toContain('sess-123');
    expect(err.message).toContain('unsupported schema version 2');
    expect(err).toBeInstanceOf(Error);
  });
});

/* ── skill/empty/index ── */

describe('EmptySkillProvider', () => {
  const skillA: Skill = { name: 'skill-a', description: 'desc a', location: 'a.md', content: 'content a' };
  const skillB: Skill = { name: 'skill-b', description: 'desc b', location: 'b.md', content: 'content b' };

  it('loadSkills returns constructor-provided skills', async () => {
    const p = new EmptySkillProvider([skillA, skillB]);
    const skills = await p.loadSkills();
    expect(skills).toEqual([skillA, skillB]);
  });

  it('loadSkills returns empty array with no constructor arg', async () => {
    const p = new EmptySkillProvider();
    expect(await p.loadSkills()).toEqual([]);
  });

  it('formatCatalog returns bullet list', () => {
    const p = new EmptySkillProvider();
    expect(p.formatCatalog([skillA, skillB])).toBe('- skill-a: desc a\n- skill-b: desc b');
  });

  it('formatCatalog handles empty array', () => {
    const p = new EmptySkillProvider();
    expect(p.formatCatalog([])).toBe('');
  });

  it('readSkillRaw returns content when found', async () => {
    const p = new EmptySkillProvider([skillA, skillB]);
    expect(await p.readSkillRaw('skill-a')).toBe('content a');
    expect(await p.readSkillRaw('skill-b')).toBe('content b');
  });

  it('readSkillRaw returns undefined when not found', async () => {
    const p = new EmptySkillProvider([skillA]);
    expect(await p.readSkillRaw('nonexistent')).toBeUndefined();
  });
});
