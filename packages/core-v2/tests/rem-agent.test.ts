import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import { REMAgent } from '../src/rem-agent.js';
import type { REMAgentEvent } from '../src/rem-agent-event.js';
import type { PiAgentLike } from '../src/pi-agent-like.js';

function assistantMessage(stopReason: 'stop' | 'error' = 'stop'): AssistantMessage {
  return {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'mock',
    model: 'mock-model',
    content: [{ type: 'text', text: 'Hello' }],
    usage: { input: 3, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    errorMessage: stopReason === 'error' ? 'boom' : undefined,
    timestamp: Date.now(),
  } as AssistantMessage;
}

/** 手写 PiAgentLike：prompt 时回放脚本化事件 */
class FakePiAgent implements PiAgentLike {
  steered: Message[] = [];
  followedUp: Message[] = [];
  aborted = false;
  private listeners: Array<(e: AgentEvent) => void> = [];

  constructor(private script: (emit: (e: AgentEvent) => void) => void) {}

  subscribe(listener: (e: AgentEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {};
  }

  async prompt(_message: Message): Promise<void> {
    this.script((e) => this.listeners.forEach((l) => void l(e)));
  }

  steer(m: Message): void { this.steered.push(m); }
  followUp(m: Message): void { this.followedUp.push(m); }
  abort(): void { this.aborted = true; }
}

async function collect(iter: AsyncIterable<REMAgentEvent>): Promise<REMAgentEvent[]> {
  const out: REMAgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('REMAgent', () => {
  it('run 产出 message-persist / usage / finish，output 解析为文本', async () => {
    const assistant = assistantMessage();
    const pi = new FakePiAgent((emit) => {
      emit({ type: 'message_end', message: { role: 'user', content: 'hi', timestamp: Date.now() } as Message } as AgentEvent);
      emit({ type: 'message_end', message: assistant } as AgentEvent);
      emit({ type: 'turn_end', message: assistant } as AgentEvent);
    });
    const agent = new REMAgent({ agentId: 'root', agent: pi });

    const events = await collect(agent.run({ content: 'hi' }));

    const types = events.map((e) => e.type);
    expect(types).toContain('message-persist');
    expect(types).toContain('usage');
    expect(types).toContain('finish');

    const persists = events.filter((e) => e.type === 'message-persist');
    expect(persists).toHaveLength(2);

    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ usage: { totalTokens: 6 } });
    expect((usage as { assistantMessageId?: string }).assistantMessageId).toBeTruthy();

    await expect(agent.output).resolves.toEqual({ content: 'Hello', completed: true });
    expect(agent.status).toBe('finished');
  });

  it('assistant stopReason=error 时发 error 事件，output 带 Error: 前缀', async () => {
    const bad = assistantMessage('error');
    const pi = new FakePiAgent((emit) => {
      emit({ type: 'message_end', message: bad } as AgentEvent);
      emit({ type: 'turn_end', message: bad } as AgentEvent);
    });
    const agent = new REMAgent({ agentId: 'root', agent: pi });

    const events = await collect(agent.run({ content: 'hi' }));

    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ error: { message: 'boom' } });
    await expect(agent.output).resolves.toEqual({ content: 'Error: boom', completed: true });
    expect(agent.status).toBe('error');
  });

  it('steer / followUp / interrupt 透传到 pi agent', async () => {
    const pi = new FakePiAgent(() => {});
    const agent = new REMAgent({ agentId: 'root', agent: pi });
    agent.steer('s');
    agent.followUp('f');
    agent.interrupt();
    expect(pi.steered).toHaveLength(1);
    expect(pi.followedUp).toHaveLength(1);
    expect(pi.aborted).toBe(true);
  });

  it('attachChild 挂树并在活跃队列中发 child-spawned', async () => {
    const pi = new FakePiAgent((emit) => {
      const childPi = new FakePiAgent(() => {});
      const child = new REMAgent({ agentId: 'root.delegate-0', agent: childPi });
      parent.attachChild(child, 'tc-1');
      emit({ type: 'turn_end', message: assistantMessage() } as AgentEvent);
    });
    const parent = new REMAgent({ agentId: 'root', agent: pi });

    const events = await collect(parent.run({ content: 'hi' }));

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].parentToolCallId).toBe('tc-1');
    const spawned = events.find((e) => e.type === 'child-spawned');
    expect(spawned).toMatchObject({ parentToolCallId: 'tc-1' });
  });

  it('running 中重复 run 抛错', async () => {
    const pi = new FakePiAgent(() => {});
    const agent = new REMAgent({ agentId: 'root', agent: pi });
    // prompt 永不 resolve → 保持 running
    pi.prompt = () => new Promise(() => {});
    agent.run({ content: 'hi' });
    expect(() => agent.run({ content: 'again' })).toThrow('already running');
  });
});
