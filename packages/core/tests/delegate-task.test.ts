import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import type { ToolContext } from 'rem-agent-core';
import { REMAgent } from '../src/agent/rem-agent.js';
import { createDelegateTaskExecutor, type DelegateTaskInput } from '../src/capabilities/sub-agent/delegate-task.js';
import type { PiAgentLike } from '../src/runtime/pi-agent-like.js';

class FakePiAgent implements PiAgentLike {
  private listeners: Array<(e: AgentEvent) => void> = [];
  constructor(private script: (emit: (e: AgentEvent) => void) => void) {}
  subscribe(l: (e: AgentEvent) => void): () => void { this.listeners.push(l); return () => {}; }
  async prompt(_m: Message): Promise<void> { this.script((e) => this.listeners.forEach((l) => void l(e))); }
  steer(): void {}
  followUp(): void {}
  abort(): void {}
}

function doneAssistant(text: string): AssistantMessage {
  return {
    role: 'assistant', api: 'openai-completions', provider: 'mock', model: 'm',
    content: [{ type: 'text', text }],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  } as AssistantMessage;
}

const toolCtx = { sessionId: 'parent-session', toolCallId: 'tc-1', workspaceRoot: '/ws' } as ToolContext;

describe('createDelegateTaskExecutor', () => {
  it('spawn child → 挂树 → 驱动子 Agent → 返回格式化结果', async () => {
    const parent = new REMAgent({ agentId: 'root', agent: new FakePiAgent(() => {}) });
    const child = new REMAgent({
      agentId: 'root.delegate-0',
      sessionId: 'child-session',
      agent: new FakePiAgent((emit) => {
        const a = doneAssistant('child done');
        emit({ type: 'message_end', message: a } as AgentEvent);
        emit({ type: 'turn_end', message: a } as AgentEvent);
      }),
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
    const parent = new REMAgent({ agentId: 'root', agent: new FakePiAgent(() => {}) });
    const executor = createDelegateTaskExecutor({
      parentAgent: parent,
      spawnChild: async () => { throw new Error('no session'); },
    });

    const result = await executor({ task: 'do thing' } as DelegateTaskInput, toolCtx);

    expect(parent.children).toHaveLength(0);
    expect(result.output).toContain('no session');
  });
});
