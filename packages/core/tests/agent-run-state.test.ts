import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { AgentRunState } from '../src/agent/agent-run-state.js';
import type { REMAgentEvent } from '../src/agent/agent-event.js';

function assistant(text: string, stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant', api: 'test', provider: 'test', model: 'test',
    content: text ? [{ type: 'text', text }] : [], stopReason, timestamp: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

async function drain(state: AgentRunState): Promise<REMAgentEvent[]> {
  state.finish();
  const events: REMAgentEvent[] = [];
  for await (const event of state.queue) events.push(event);
  return events;
}

describe('AgentRunState', () => {
  it('emits message-persist for normal assistant messages', async () => {
    const state = new AgentRunState([]);
    state.ingest({ type: 'message_end', message: assistant('hello', 'stop') });
    const persisted = (await drain(state)).filter((event) => event.type === 'message-persist');
    expect(persisted).toHaveLength(1);
  });

  it('skips message-persist for error assistant messages', async () => {
    const state = new AgentRunState([]);
    state.ingest({ type: 'message_end', message: assistant('', 'error') });
    const persisted = (await drain(state)).filter((event) => event.type === 'message-persist');
    expect(persisted).toHaveLength(0);
  });
});
