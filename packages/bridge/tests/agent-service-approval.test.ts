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
    await rm(dir, { recursive: true, force: true });
  });

  it('emits approval-request chunk and resolves via resolveApproval', async () => {
    const summary = await service.createSession();
    const stream = await service.run(summary.sessionId, '写一首诗到当前的工作空间');

    const chunks: any[] = [];
    let approvalId: string | undefined;

    for await (const chunk of stream) {
      chunks.push(chunk);
      if (chunk.type === 'approval-request') {
        approvalId = chunk.request.approvalId;
        break;
      }
    }

    expect(approvalId).toBeDefined();
    expect(chunks.some((c) => c.type === 'approval-request' && c.request.toolName === 'write')).toBe(true);

    const pending = await service.listPendingApprovals(summary.sessionId);
    expect(pending.some((r) => r.approvalId === approvalId)).toBe(true);

    const resolved = await service.resolveApproval(approvalId!, 'allow-once');
    expect(resolved).toBe(true);

    // consume remaining chunks until we see the resolved event and tool result
    for await (const chunk of stream) {
      chunks.push(chunk);
      if (
        chunks.some((c) => c.type === 'approval-resolved' && c.decision === 'allow-once') &&
        chunks.some((c) => c.type === 'tool-result')
      ) {
        break;
      }
    }

    expect(chunks.some((c) => c.type === 'approval-resolved' && c.decision === 'allow-once')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool-result')).toBe(true);
  });
});
