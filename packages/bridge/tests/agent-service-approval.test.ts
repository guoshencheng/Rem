import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';
import {
  FileSessionProvider,
  createProviderManager,
  DefaultConfigProvider,
  registerProvider,
  clearProviders,
} from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';
import { BridgeAgentStateProvider } from '../src/agent-state-provider.js';

describe('AgentService approval flow', () => {
  let dir: string;
  let pm: ProviderManager;
  let service: AgentService;

  beforeEach(async () => {
    clearProviders();
    dir = await mkdtemp(join(tmpdir(), 'agent-service-approval-test-'));

    registerProvider('mock-writer', {
      resolveConfig() {
        return { provider: 'mock-writer', model: 'mock-model', apiKey: 'fake-key' };
      },
      async generate() {
        return { text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      },
      async *stream() {
        yield {
          type: 'tool-call' as const,
          toolCallId: 'tc-write-1',
          toolName: 'write',
          input: { path: './poem.txt', content: 'A poem' },
        };
        yield { type: 'usage' as const, inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });

    const sessionProvider = new FileSessionProvider(dir);
    const configProvider = new DefaultConfigProvider({
      overrides: {
        name: 'ApprovalTestAgent',
        model: { provider: 'mock-writer', model: 'mock-model' },
        autoApproveDangerous: false,
        workspaceRoot: dir,
      },
    });
    await configProvider.init();

    pm = await createProviderManager({
      sessionProvider,
      configProvider,
      agentStateProvider: new BridgeAgentStateProvider(),
    });
    service = new AgentService(pm);
  });

  afterEach(async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await rm(dir, { recursive: true, force: true });
        return;
      } catch (err) {
        if (i === 4) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  });

  it.skip('emits approval-request via bus and resolves via resolveApproval', async () => {
    const summary = await service.createSession();

    // Subscribe to the broadcast bus (the only data source now).
    const events: any[] = [];
    const busIterable = service.stream();
    const iterator = busIterable[Symbol.asyncIterator]();
    const pump = (async () => {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) break;
        events.push(value);
      }
    })();

    await service.run(summary.sessionId, '写一首诗到当前的工作空间');

    // wait until an approval-request chunk shows up on the bus
    let approvalId: string | undefined;
    for (let i = 0; i < 100 && !approvalId; i++) {
      const ev = events.find(
        (e) => e.type === 'chunk' && e.chunk.type === 'approval-request',
      );
      if (ev) approvalId = ev.chunk.request.approvalId;
      else await new Promise((r) => setTimeout(r, 20));
    }
    expect(approvalId).toBeDefined();

    const pending = await service.listPendingApprovals(summary.sessionId);
    expect(pending.some((r) => r.approvalId === approvalId)).toBe(true);

    const resolved = await service.resolveApproval(approvalId!, 'allow-once');
    expect(resolved).toBe(true);

    // wait for resolved + tool-result on the bus
    for (let i = 0; i < 100; i++) {
      const hasResolved = events.some(
        (e) => e.type === 'chunk' && e.chunk.type === 'approval-resolved' && e.chunk.decision === 'allow-once',
      );
      const hasToolResult = events.some(
        (e) => e.type === 'chunk' && e.chunk.type === 'tool-result',
      );
      if (hasResolved && hasToolResult) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'approval-resolved' && e.chunk.decision === 'allow-once')).toBe(true);
    expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'tool-result')).toBe(true);

    // return() would hang on the pending bus Promise; race with a timeout
    await Promise.race([
      iterator.return?.(),
      new Promise<void>((r) => setTimeout(r, 200)),
    ]);
    pump.catch(() => {});
  });
});
