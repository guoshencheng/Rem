import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';
import { bus } from '../src/broadcast-bus.js';
import { runRegistry } from '../src/run-registry.js';
import {
  FileSessionProvider,
  createProviderManager,
  DefaultConfigProvider,
  registerProvider,
  clearProviders,
} from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';
import type { BusEvent } from '../src/types.js';

describe('AgentService.run background driver', () => {
  let dir: string;
  let pm: ProviderManager;
  let service: AgentService;

  beforeEach(async () => {
    clearProviders();
    dir = await mkdtemp(join(tmpdir(), 'agent-service-run-test-'));

    registerProvider('mock-run', {
      resolveConfig() {
        return { model: 'mock-model', apiKey: 'fake-key' };
      },
      async generate() {
        return { text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      },
      async *stream() {
        yield { type: 'text' as const, text: 'Hello' };
        yield { type: 'usage' as const, inputTokens: 3, outputTokens: 3, totalTokens: 6 };
      },
    });

    const sessionProvider = new FileSessionProvider(dir);
    const configProvider = new DefaultConfigProvider({
      overrides: {
        name: 'RunTestAgent',
        model: { provider: 'mock-run', model: 'mock-model' },
        workspaceRoot: dir,
      },
    });
    await configProvider.init();
    pm = await createProviderManager({ sessionProvider, configProvider });
    service = new AgentService(pm);
  });

  afterEach(async () => {
    for (let i = 0; i < 5; i++) {
      try { await rm(dir, { recursive: true, force: true }); break; }
      catch { await new Promise((r) => setTimeout(r, 50)); }
    }
  });

  function collectBus(sessionId: string): { events: BusEvent[]; stop: () => void } {
    const events: BusEvent[] = [];
    const unsub = bus.subscribe((e) => {
      if (e.sessionId === sessionId) events.push(e);
    });
    return { events, stop: unsub };
  }

  it('run() resolves immediately and registers the run', async () => {
    const summary = await service.createSession();
    const p = service.run(summary.sessionId, 'hi');
    await expect(p).resolves.toBeUndefined();
  });

  it('driver broadcasts chunks to the bus without any run-return consumption', async () => {
    const summary = await service.createSession();
    const { events, stop } = collectBus(summary.sessionId);

    await service.run(summary.sessionId, 'hi');

    for (let i = 0; i < 100 && runRegistry.has(summary.sessionId); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    stop();

    const types = events.map((e) => e.type);
    expect(types).toContain('session-start');
    expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'message-start')).toBe(true);
    expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'finish')).toBe(true);
    expect(types).toContain('session-end');
    expect(runRegistry.has(summary.sessionId)).toBe(false);
  });

  it('rejects concurrent run for the same session with 409', async () => {
    const summary = await service.createSession();
    const ac = new AbortController();
    runRegistry.register(summary.sessionId, ac);
    await expect(service.run(summary.sessionId, 'hi')).rejects.toThrow(/already running/);
    runRegistry.remove(summary.sessionId);
  });
});
