import { describe, expect, it } from 'vitest';
import type { ToolContext } from 'rem-agent-core';
import { createDelegateTaskExecutor, type DelegateTaskInput } from '../src/capabilities/sub-agent/delegate-task.js';

const toolCtx = { sessionId: 'parent-session', toolCallId: 'tc-1', workspaceRoot: '/ws' } as ToolContext;

describe('createDelegateTaskExecutor', () => {
  it('调用委派端口并返回格式化结果', async () => {
    const executor = createDelegateTaskExecutor(async () => ({
      childSessionId: 'child-session', content: 'child done', status: 'completed',
    }));

    const result = await executor({ task: 'do thing' } as DelegateTaskInput, toolCtx);

    expect(result.output).toContain('child-session');
    expect(result.output).toContain('child done');
  });

  it('委派端口抛错时返回 failed 结果，不抛出', async () => {
    const executor = createDelegateTaskExecutor(async () => { throw new Error('no session'); });

    const result = await executor({ task: 'do thing' } as DelegateTaskInput, toolCtx);

    expect(result.output).toContain('no session');
  });
});
