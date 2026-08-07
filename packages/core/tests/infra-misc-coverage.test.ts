import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { resolveContextWindow, computeWindowRatio } from '../src/infrastructure/llm/context-window.js';
import { createCoreModels } from '../src/infrastructure/llm/models.js';
import { patchMiniMaxAdaptiveThinking } from '../src/infrastructure/llm/patch-minimax-compat.js';
import { createDefaultAgentPaths, resolveTilde, type AgentPaths } from '../src/infrastructure/config/paths.js';
import { setLogSink, configureConsoleOutput, log, debugLog, flushDebugLog, isDebugEnabled } from '../src/infrastructure/observability/debug-log.js';
import type { Models, Model } from '@earendil-works/pi-ai';
import { createMockProvider } from './helpers/mock-models.js';
import { homedir } from 'os';
import { join } from 'path';

// ─── context-window ──────────────────────────────────────────────

describe('resolveContextWindow', () => {
  const env: NodeJS.ProcessEnv = {};

  it('returns global MAX_CONTEXT_TOKENS override first', () => {
    expect(resolveContextWindow('openai', 'gpt-4', { ...env, MAX_CONTEXT_TOKENS: '5000' })).toBe(5000);
  });

  it('falls back to model-specific env override', () => {
    expect(resolveContextWindow('openai', 'gpt-4', { OPENAI_GPT_4_MAX_CONTEXT_TOKENS: '6000' })).toBe(6000);
  });

  it('sanitizes model name for env key lookup', () => {
    expect(resolveContextWindow('openai', 'gpt-4.5-beta', { OPENAI_GPT_4_5_BETA_MAX_CONTEXT_TOKENS: '8000' })).toBe(8000);
  });

  it('uses known model contextWindow from Models registry', () => {
    const models = createMockProvider({ name: 'openai' });
    const mockModels: Models = {
      getModel: () => ({ provider: 'openai', name: 'gpt-4', contextWindow: 32000 } as Model<any>),
    } as unknown as Models;
    expect(resolveContextWindow('openai', 'gpt-4', {}, mockModels)).toBe(32000);
  });

  it('falls back to DEFAULT_CONTEXT_WINDOW when nothing matches', () => {
    expect(resolveContextWindow('unknown', 'no-model', {}, undefined)).toBe(1_000_000);
  });

  it('ignores non-positive env overrides', () => {
    expect(resolveContextWindow('openai', 'gpt-4', { MAX_CONTEXT_TOKENS: '0' })).not.toBe(0);
    expect(resolveContextWindow('openai', 'gpt-4', { MAX_CONTEXT_TOKENS: '-1' })).toBeGreaterThan(0);
  });

  it('ignores NaN env overrides', () => {
    expect(resolveContextWindow('openai', 'gpt-4', { MAX_CONTEXT_TOKENS: 'abc' })).toBeGreaterThan(0);
  });
});

describe('computeWindowRatio', () => {
  it('returns 0 when maxTokens <= 0', () => {
    expect(computeWindowRatio({ totalTokens: 100 }, 0)).toBe(0);
    expect(computeWindowRatio({ totalTokens: 100 }, -1)).toBe(0);
  });

  it('returns ratio capped at 1', () => {
    expect(computeWindowRatio({ totalTokens: 500 }, 1000)).toBe(0.5);
    expect(computeWindowRatio({ totalTokens: 2000 }, 1000)).toBe(1);
  });
});

// ─── models ──────────────────────────────────────────────────────

describe('createCoreModels', () => {
  it('returns empty models by default (no providers)', () => {
    const models = createCoreModels();
    expect(models).toBeDefined();
  });

  it('creates models with all builtin providers when all=true', () => {
    const models = createCoreModels({ all: true });
    expect(models).toBeDefined();
  });

  it('registers custom providers', () => {
    const models = createCoreModels({ customProviders: [createMockProvider({ name: 'custom' })] });
    expect(models).toBeDefined();
    expect(models.getModel('custom', 'mock-model')).toBeDefined();
  });

  it('handles empty options', () => {
    const models = createCoreModels({});
    expect(models).toBeDefined();
  });
});

// ─── patch-minimax-compat ────────────────────────────────────────

describe('patchMiniMaxAdaptiveThinking', () => {
  it('sets forceAdaptiveThinking for minimax anthropic-messages model', () => {
    const model = {
      provider: 'minimax',
      name: 'm1',
      api: 'anthropic-messages',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    } as Model<any>;
    patchMiniMaxAdaptiveThinking(model);
    expect((model as Model<'anthropic-messages'>).compat?.forceAdaptiveThinking).toBe(true);
  });

  it('sets forceAdaptiveThinking for minimax-cn', () => {
    const model = {
      provider: 'minimax-cn',
      name: 'm2',
      api: 'anthropic-messages',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    } as Model<any>;
    patchMiniMaxAdaptiveThinking(model);
    expect((model as Model<'anthropic-messages'>).compat?.forceAdaptiveThinking).toBe(true);
  });

  it('skips non-minimax providers', () => {
    const model = {
      provider: 'openai',
      name: 'gpt-4',
      api: 'anthropic-messages',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    } as Model<any>;
    patchMiniMaxAdaptiveThinking(model);
    expect((model as Model<'anthropic-messages'>).compat).toBeUndefined();
  });

  it('skips minimax model without anthropic-messages api', () => {
    const model = {
      provider: 'minimax',
      name: 'm3',
      api: 'openai-completions',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    } as Model<any>;
    patchMiniMaxAdaptiveThinking(model);
    expect((model as Model<'anthropic-messages'>).compat).toBeUndefined();
  });

  it('preserves existing compat when adding forceAdaptiveThinking', () => {
    const model = {
      provider: 'minimax',
      name: 'm4',
      api: 'anthropic-messages',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
      compat: { existingFlag: true },
    } as Model<any>;
    patchMiniMaxAdaptiveThinking(model);
    const compat = (model as Model<'anthropic-messages'>).compat;
    expect(compat?.forceAdaptiveThinking).toBe(true);
    expect((compat as any)?.existingFlag).toBe(true);
  });
});

// ─── config/paths ────────────────────────────────────────────────

describe('createDefaultAgentPaths', () => {
  it('creates default paths', () => {
    const paths = createDefaultAgentPaths();
    expect(paths.agentDir).toBeDefined();
    expect(paths.homeSkillsDir).toBeDefined();
    expect(paths.debugLogFile).toBeDefined();
  });

  it('uses custom agentDir', () => {
    const paths = createDefaultAgentPaths({ agentDir: '/custom/agent' });
    expect(paths.agentDir).toBe('/custom/agent');
  });

  it('uses REM_AGENT_HOME env var', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_HOME: '/env/agent' } });
    expect(paths.agentDir).toBe('/env/agent');
  });

  it('uses REM_AGENT_DIR env var', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_DIR: '/env/dir' } });
    expect(paths.agentDir).toBe('/env/dir');
  });

  it('expands tilde in agent dir', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_HOME: '~/my-agent' } });
    expect(paths.agentDir).toBe(join(homedir(), 'my-agent'));
  });

  it('uses custom homeAgentDir and homeSkillsDir', () => {
    const paths = createDefaultAgentPaths({ homeAgentDir: '/home/custom', homeSkillsDir: '/home/skills' });
    expect(paths.homeSkillsDir).toBe('/home/skills');
  });

  it('returns homeConfigCandidates from homeAgentDir', () => {
    const paths = createDefaultAgentPaths({ homeAgentDir: '/test' });
    const candidates = paths.homeConfigCandidates();
    expect(candidates).toContain(join('/test', 'config.json'));
    expect(candidates).toContain(join('/test', 'config.yaml'));
    expect(candidates).toContain(join('/test', 'config.yml'));
  });

  it('returns workspaceConfigCandidates for a given workspace', () => {
    const paths = createDefaultAgentPaths();
    const candidates = paths.workspaceConfigCandidates('/ws');
    expect(candidates).toContain(join('/ws', 'rem-agent.config.json'));
    expect(candidates).toContain(join('/ws', '.rem-agent', 'config.json'));
  });

  it('configCandidates merges workspace and home', () => {
    const paths = createDefaultAgentPaths({ homeAgentDir: '/test' });
    const candidates = paths.configCandidates('/ws');
    // workspace candidates come first
    expect(candidates[0]).toBe(join('/ws', 'rem-agent.config.json'));
    // home candidates follow
    expect(candidates[candidates.length - 1]).toBe(join('/test', 'config.yml'));
  });

  it('workspaceSkillsDir returns .agents/skills under workspace', () => {
    const paths = createDefaultAgentPaths();
    expect(paths.workspaceSkillsDir('/ws')).toBe(join('/ws', '.agents', 'skills'));
  });

  it('debugLogFile resolves from REM_AGENT_DEBUG_FILE', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_DEBUG_FILE: '/tmp/debug.log' } });
    expect(paths.debugLogFile).toBe('/tmp/debug.log');
  });

  it('debugLogFile resolves from REM_AGENT_DEBUG=1', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_DEBUG: '1' } });
    expect(paths.debugLogFile).toBe('/tmp/rem-agent-debug.log');
  });

  it('debugLogFile resolves in development mode', () => {
    const paths = createDefaultAgentPaths({ env: { NODE_ENV: 'development' } });
    expect(paths.debugLogFile).toBe(join(paths.agentDir, 'debug.log'));
  });

  it('debugLogFile is null when not in dev and no debug env', () => {
    const paths = createDefaultAgentPaths({ env: {} });
    // When NODE_ENV is not 'development' and no REM_AGENT_DEBUG_*, debugLogFile is null
    // Note: this depends on process.env.NODE_ENV not being 'development'
    if (process.env.NODE_ENV !== 'development') {
      expect(paths.debugLogFile).toBeNull();
    }
  });
});

describe('resolveTilde', () => {
  it('expands ~ to home directory', () => {
    expect(resolveTilde('~/foo')).toBe(join(homedir(), 'foo'));
  });

  it('returns path unchanged when no tilde', () => {
    expect(resolveTilde('/absolute/path')).toBe('/absolute/path');
  });
});

// ─── debug-log ───────────────────────────────────────────────────

describe('debug-log', () => {
  let sinkLines: string[] = [];

  beforeEach(() => {
    sinkLines = [];
    setLogSink(null);
    configureConsoleOutput(false);
  });

  afterEach(async () => {
    await flushDebugLog();
    setLogSink(null);
    configureConsoleOutput(false);
  });

  it('isDebugEnabled returns false when no sink', () => {
    expect(isDebugEnabled()).toBe(false);
  });

  it('isDebugEnabled returns true when sink is set', () => {
    setLogSink(() => {});
    expect(isDebugEnabled()).toBe(true);
    setLogSink(null);
  });

  it('log writes to sink and flushes', async () => {
    setLogSink((line) => { sinkLines.push(line); });
    log('test', 'hello', { sessionId: 's1' });
    await flushDebugLog();
    expect(sinkLines.length).toBeGreaterThanOrEqual(1);
    expect(sinkLines[0]).toContain('[test]');
    expect(sinkLines[0]).toContain('hello');
    expect(sinkLines[0]).toContain('sessionId=s1');
  });

  it('log ignores undefined context fields', async () => {
    setLogSink((line) => { sinkLines.push(line); });
    log('test', 'hello', { sessionId: undefined, step: 1 });
    await flushDebugLog();
    expect(sinkLines[0]).toContain('step=1');
    expect(sinkLines[0]).not.toContain('sessionId=undefined');
  });

  it('debugLog delegates to log', async () => {
    setLogSink((line) => { sinkLines.push(line); });
    debugLog('dbg', 'msg');
    await flushDebugLog();
    expect(sinkLines[0]).toContain('[dbg]');
    expect(sinkLines[0]).toContain('msg');
  });

  it('setLogSink(null) clears buffer and timer', () => {
    setLogSink(() => {});
    log('test', 'msg');
    setLogSink(null);
    expect(isDebugEnabled()).toBe(false);
  });

  it('configureConsoleOutput toggles console output', () => {
    configureConsoleOutput(true);
    // No direct assertion possible but ensure no throw
    log('test', 'msg');
    configureConsoleOutput(false);
  });

  it('flushDebugLog does nothing when no sink', async () => {
    await expect(flushDebugLog()).resolves.toBeUndefined();
  });

  it('buffer fills up and triggers flush', async () => {
    setLogSink((line) => { sinkLines.push(line); });
    // Write many logs to trigger buffer flush
    for (let i = 0; i < 1001; i++) {
      log('bulk', `msg ${i}`);
    }
    await flushDebugLog();
    expect(sinkLines.length).toBeGreaterThan(0);
  });

  it('handles sink throwing errors silently', async () => {
    setLogSink(() => { throw new Error('write fail'); });
    log('test', 'msg');
    await flushDebugLog();
    // Should not throw
    expect(true).toBe(true);
  });

  it('re-schedules flush when new logs arrive during flushing', async () => {
    let callCount = 0;
    setLogSink(() => {
      callCount++;
      // Fill buffer beyond MAX (1000) during sink execution to trigger the
      // no-scheduleFlush path in writeToFile, then finally block sees
      // buffer.length > 0 && !flushTimer → scheduleFlush
      if (callCount === 1) {
        for (let i = 0; i < 1010; i++) {
          log('during', `flush ${i}`);
        }
      }
    });
    log('test', 'first');
    await flushDebugLog();
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('scheduleFlush eventually flushes buffer', async () => {
    setLogSink((line) => { sinkLines.push(line); });
    log('test', 'delayed');
    // Wait for the scheduled flush (100ms interval)
    await new Promise((r) => setTimeout(r, 200));
    await flushDebugLog();
    expect(sinkLines.some((l) => l.includes('delayed'))).toBe(true);
  });
});
