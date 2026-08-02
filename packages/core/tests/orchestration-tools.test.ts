import { describe, expect, it, vi } from 'vitest';
import { assembleAgentLoop } from '../src/runtime/agent-loop-assembler.js';
import { createCommunicationMessage } from '../src/orchestration/communication-message.js';
import { createFakeAssembly, fakeSession } from './helpers/fake-di.js';

describe('orchestration tools', () => {
  it('injects send for Members and finish only when the action is available', async () => {
    const { di, runtimeConfig } = await createFakeAssembly();
    const base = { di, runtimeConfig, session: fakeSession(), sessionId: 's-1', workspace: 'default',
      messages: () => [], drainSteering: () => [], drainFollowUp: () => [], emitMeta: () => undefined };
    const sendMessage = vi.fn(async () => ({ batchId: 'batch' }));
    const member = await assembleAgentLoop({ ...base, orchestrationActions: { sendMessage } });
    const finishDiscussion = vi.fn(async () => undefined);
    const organizer = await assembleAgentLoop({ ...base,
      orchestrationActions: { sendMessage, finishDiscussion } });

    expect(member.context.tools?.map((tool) => tool.name)).toContain('send_message');
    expect(member.context.tools?.map((tool) => tool.name)).not.toContain('finish_discussion');
    expect(organizer.context.tools?.map((tool) => tool.name)).toContain('finish_discussion');

    const send = organizer.context.tools?.find((tool) => tool.name === 'send_message')!;
    await send.execute('call', { to: [' architect ', 'architect'], content: '  review  ' });
    expect(sendMessage).toHaveBeenCalledWith({ toAgentIds: ['architect'], content: 'review' });
    const finish = organizer.context.tools?.find((tool) => tool.name === 'finish_discussion')!;
    await finish.execute('finish', { answer: '  final answer  ' });
    expect(finishDiscussion).toHaveBeenCalledWith('final answer');
  });

  it('constructs a valid zero-usage pi AssistantMessage', () => {
    expect(createCommunicationMessage({ api: 'responses', provider: 'openai', id: 'gpt' }, 'hello'))
      .toMatchObject({ role: 'assistant', api: 'responses', provider: 'openai', model: 'gpt',
        content: [{ type: 'text', text: 'hello' }], stopReason: 'stop', usage: { totalTokens: 0 } });
  });
});
