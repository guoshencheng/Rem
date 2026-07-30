import { describe, expect, it } from 'vitest';
import type { ToolContext } from 'rem-agent-core';
import { createDelegateTaskExecutor, type DelegateTaskInput } from '../src/capabilities/sub-agent/delegate-task.js';
import { fauxAssistantMessage } from './helpers/scripted-models.js';
import { createTestAgent } from './helpers/test-agent.js';

const toolCtx = { sessionId: 'parent-session', toolCallId: 'tc-1', workspaceRoot: '/ws' } as ToolContext;

describe('createDelegateTaskExecutor', () => {
  it('spawn child → 挂树 → 驱动子 Agent → 返回格式化结果', async () => {
    const { agent: parent } = await createTestAgent({ steps: [] });
    const { agent: child } = await createTestAgent({
      steps: [fauxAssistantMessage('child done')],
      agentId: 'root.delegate-0',
      sessionId: 'child-session',
    });
    const executor = createDelegateTaskExecutor({
      parentAgent: parent,
      spawnChild: async () => child,
    });

    const result = await executor({ task: 'do thing' } as DelegateTaskInput, toolCtx);

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(child);
    expect(child.parentToolCallId).toBe('tc-1');
    expect(child.status).toBe('finished');
    expect(result.output).toContain('child done');
  });

  it('spawnChild 抛错时返回 failed 结果，不抛出', async () => {
    const { agent: parent } = await createTestAgent({ steps: [] });
    const executor = createDelegateTaskExecutor({
      parentAgent: parent,
      spawnChild: async () => { throw new Error('no session'); },
    });

    const result = await executor({ task: 'do thing' } as DelegateTaskInput, toolCtx);

    expect(parent.children).toHaveLength(0);
    expect(result.output).toContain('no session');
  });
});
