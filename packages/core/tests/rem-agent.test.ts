import { describe, expect, it } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { REMAgent } from '../src/agent/rem-agent.js';
import type { REMAgentEvent } from '../src/agent/agent-event.js';
import { fauxAssistantMessage, fauxToolCall, type ScriptedStep } from './helpers/scripted-models.js';
import { createTestAgent } from './helpers/test-agent.js';

const userMessage = (text: string): Message =>
  ({ role: 'user', content: text, timestamp: Date.now() }) as Message;

async function collect(iter: AsyncIterable<REMAgentEvent>): Promise<REMAgentEvent[]> {
  const out: REMAgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('REMAgent', () => {
  it('run 会把构造时恢复的 transcript 传给模型', async () => {
    const seen: string[][] = [];
    const { agent } = await createTestAgent({
      conversation: [userMessage('old'), fauxAssistantMessage('old reply')],
      steps: [({ context }) => {
        seen.push(context.messages.map((message) => message.role));
        return fauxAssistantMessage('new reply');
      }],
    });
    await collect(agent.run({ content: 'new' }));
    expect(seen).toEqual([['user', 'assistant', 'user']]);
  });

  it('syncTranscript 在空闲时替换上下文且不产生持久化事件', async () => {
    const seen: string[][] = [];
    const incoming = userMessage('projected');
    const { agent } = await createTestAgent({
      conversation: [userMessage('stale')],
      steps: [({ context }) => {
        seen.push(context.messages.map((message) => message.role));
        expect(() => agent.syncTranscript([])).toThrow('already running');
        return fauxAssistantMessage('reply');
      }],
    });
    agent.syncTranscript([incoming]);
    const events = await collect(agent.continue());
    expect(seen).toEqual([['user']]);
    expect(events.filter((event) => event.type === 'message-persist')).toHaveLength(1);
  });

  it('run 产出 message-persist / usage / finish，output 解析为文本', async () => {
    const { agent } = await createTestAgent({ steps: [fauxAssistantMessage('Hello')] });

    const events = await collect(agent.run({ content: 'hi' }));

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('agent_start');
    expect(types).toContain('turn_start');
    expect(types).toContain('turn_end');
    expect(types[types.length - 1]).toBe('finish');

    const persists = events.filter((e) => e.type === 'message-persist');
    expect(persists).toHaveLength(2);

    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toBeTruthy();
    expect((usage as { assistantMessageId?: string }).assistantMessageId).toBeTruthy();

    await expect(agent.output).resolves.toEqual({ content: 'Hello', completed: true });
    expect(agent.status).toBe('finished');
  });

  it('assistant stopReason=error 时发 error 事件，output 带 Error: 前缀', async () => {
    const { agent } = await createTestAgent({
      steps: [fauxAssistantMessage('boom', { stopReason: 'error', errorMessage: 'boom' })],
    });

    const events = await collect(agent.run({ content: 'hi' }));

    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ error: { message: 'boom' } });
    await expect(agent.output).resolves.toEqual({ content: 'Error: boom', completed: true });
    expect(agent.status).toBe('error');
  });

  it('tool call 循环：执行工具 → toolResult 落盘事件 → 第二轮文本', async () => {
    const executed: string[] = [];
    const { agent, state } = await createTestAgent({
      steps: [fauxAssistantMessage([fauxToolCall('echo', {})]), fauxAssistantMessage('done')],
      tools: [{
        name: 'echo',
        run: async () => {
          executed.push('echo');
          return 'echoed';
        },
      }],
    });

    const events = await collect(agent.run({ content: 'go' }));

    expect(executed).toEqual(['echo']);
    expect(state.callCount).toBe(2);
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_execution_start');
    expect(types).toContain('tool_execution_end');
    const toolResults = events.filter(
      (e) => e.type === 'message_end' && (e.message as Message).role === 'toolResult',
    );
    expect(toolResults).toHaveLength(1);
  });

  it('steer 消息在下一轮注入到 LLM 上下文', async () => {
    const seen: string[][] = [];
    let agent!: REMAgent;
    const steps: ScriptedStep[] = [
      ({ context }) => {
        seen.push(context.messages.map((m) => m.role));
        agent.steer('steered');
        return fauxAssistantMessage([fauxToolCall('noop', {})]);
      },
      ({ context }) => {
        seen.push(context.messages.map((m) => m.role));
        return fauxAssistantMessage('ok');
      },
    ];
    const created = await createTestAgent({
      steps,
      tools: [{ name: 'noop', run: async () => '' }],
    });
    agent = created.agent;

    await collect(agent.run({ content: 'go' }));

    // 第二轮上下文：user / assistant(toolCall) / toolResult / user(steered)
    expect(seen[1]).toEqual(['user', 'assistant', 'toolResult', 'user']);
  });

  it('followUp 在 agent 即将停止时注入并续跑', async () => {
    const seen: string[][] = [];
    let agent!: REMAgent;
    const steps: ScriptedStep[] = [
      ({ context }) => {
        seen.push(context.messages.map((m) => m.role));
        agent.followUp('later');
        return fauxAssistantMessage('one');
      },
      ({ context }) => {
        seen.push(context.messages.map((m) => m.role));
        return fauxAssistantMessage('two');
      },
    ];
    const created = await createTestAgent({ steps });
    agent = created.agent;

    await collect(agent.run({ content: 'go' }));

    expect(created.state.callCount).toBe(2);
    expect(seen[1]).toEqual(['user', 'assistant', 'user']);
  });

  it('interrupt 中断当前 run，最终 turn stopReason=aborted', async () => {
    let agent!: REMAgent;
    const steps: ScriptedStep[] = [
      () => {
        agent.interrupt();
        return fauxAssistantMessage('never');
      },
    ];
    const created = await createTestAgent({ steps });
    agent = created.agent;

    const events = await collect(agent.run({ content: 'go' }));

    const lastTurnEnd = [...events].reverse().find((e) => e.type === 'turn_end');
    expect(lastTurnEnd).toMatchObject({ message: { stopReason: 'aborted' } });
  });

  it('maxTurns 达到上限后 abort，下一轮响应 stopReason=aborted', async () => {
    const { agent } = await createTestAgent({
      steps: [fauxAssistantMessage([fauxToolCall('noop', {})]), fauxAssistantMessage('never reached')],
      tools: [{ name: 'noop', run: async () => '' }],
      maxTurns: 1,
    });

    const events = await collect(agent.run({ content: 'go' }));

    const lastTurnEnd = [...events].reverse().find((e) => e.type === 'turn_end');
    expect(lastTurnEnd).toMatchObject({ message: { stopReason: 'aborted' } });
  });

  it('todowrite 工具经 agent 事件流抛出 todo-updated meta 事件', async () => {
    const todos = [{ content: 'task a', status: 'in_progress', priority: 'high' }];
    const { agent } = await createTestAgent({
      steps: [
        fauxAssistantMessage([fauxToolCall('todowrite', { todos })]),
        fauxAssistantMessage('done'),
      ],
    });

    const events = await collect(agent.run({ content: 'go' }));

    const todoEvent = events.find((e) => e.type === 'todo-updated');
    expect(todoEvent).toMatchObject({ sessionId: 's-1', todos });
  });

  it('子 Agent 覆盖：systemPrompt / maxTurns 经 REMAgentParams 直接生效', async () => {
    const seenSystemPrompts: string[] = [];
    const { agent } = await createTestAgent({
      steps: [
        ({ context }) => {
          seenSystemPrompts.push(context.systemPrompt);
          return fauxAssistantMessage([fauxToolCall('noop', {})]);
        },
        fauxAssistantMessage('never reached'),
      ],
      tools: [{ name: 'noop', run: async () => '' }],
      systemPrompt: 'child static prompt',
      maxTurns: 1,
    });

    const events = await collect(agent.run({ content: 'go' }));

    expect(seenSystemPrompts).toEqual(['child static prompt']);
    const lastTurnEnd = [...events].reverse().find((e) => e.type === 'turn_end');
    expect(lastTurnEnd).toMatchObject({ message: { stopReason: 'aborted' } });
  });

  it('running 中重复 run 抛错', async () => {
    const { agent } = await createTestAgent({ steps: [() => new Promise(() => {})] });
    agent.run({ content: 'hi' });
    expect(() => agent.run({ content: 'again' })).toThrow('already running');
  });

  it('continue：toolResult 结尾的 transcript 可直接续跑', async () => {
    const { agent, state } = await createTestAgent({
      steps: [fauxAssistantMessage('continued')],
      conversation: [
        userMessage('hi'),
        {
          role: 'toolResult',
          toolCallId: 'tc-1',
          toolName: 'echo',
          content: [{ type: 'text', text: 'result' }],
          details: {},
          isError: false,
          timestamp: Date.now(),
        } as Message,
      ],
    });

    const events = await collect(agent.continue());

    expect(events.map((e) => e.type)[0]).toBe('agent_start');
    await expect(agent.output).resolves.toEqual({ content: 'continued', completed: true });
    expect(state.callCount).toBe(1);
  });

  it('continue：assistant 结尾且无 steering 时抛错；有 steering 时以 steering 续跑', async () => {
    const { agent, scripted } = await createTestAgent({ steps: [fauxAssistantMessage('seed reply')] });
    await collect(agent.run({ content: 'seed' }));

    expect(() => agent.continue()).toThrow('assistant');

    scripted.setResponses([fauxAssistantMessage('after steering')]);
    agent.steer('again');
    const events = await collect(agent.continue());
    expect(events.map((e) => e.type)[0]).toBe('agent_start');
    await expect(agent.output).resolves.toEqual({ content: 'after steering', completed: true });
  });
});
