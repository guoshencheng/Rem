import { describe, expect, it } from 'vitest';
import type { AgentSystemEvent } from '../src/agent/bus-events.js';
import type { MessageEntryPayload } from '../src/session/messages/payload.js';
import type { SessionTreeEntry } from '../src/session/tree/types.js';
import { DEFAULT_PRIMARY_PROFILE_ID } from '../src/agent-profile/service.js';
import { REMAgent } from '../src/agent/rem-agent.js';
import { createAgentSystem } from '../src/system/create-agent-system.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

async function waitForTerminal(
  events: AsyncIterable<AgentSystemEvent>,
  sessionId: string,
): Promise<void> {
  for await (const event of events) {
    if (event.sessionId === sessionId && (event.type === 'session-end' || event.type === 'session-error')) return;
  }
}

function messagePayloads(entries: SessionTreeEntry[]): MessageEntryPayload[] {
  return entries
    .filter((entry) => entry.type === 'message')
    .map((entry) => entry.payload as MessageEntryPayload);
}

describe('AgentSystem AgentThread binding', () => {
  it('persists one primary identity and restores projected history after restart', async () => {
    const contexts: string[][] = [];
    const scripted = createScriptedModels([
      fauxAssistantMessage('first'),
      ({ context }) => {
        contexts.push(context.messages.map((message) => message.role));
        return fauxAssistantMessage('second');
      },
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const firstSystem = createAgentSystem(assembly);
    const session = await firstSystem.createSession({ workspace: 'ws' });
    let terminal = waitForTerminal(firstSystem.events(), session.sessionId);
    await firstSystem.send({ sessionId: session.sessionId, content: 'one' });
    await terminal;

    const firstThreads = await assembly.di.storage.agentThreadStore.listBySession(session.sessionId);
    expect(firstThreads).toHaveLength(1);
    expect(firstThreads[0]).toMatchObject({
      agentProfileId: DEFAULT_PRIMARY_PROFILE_ID,
      role: 'primary',
      lifecycle: 'persistent',
    });
    const entries = messagePayloads(await assembly.di.sessionProvider.listEntries(session.sessionId));
    expect(entries.map(({ author, scope }) => ({ author, scope }))).toEqual([
      { author: { type: 'user' }, scope: { type: 'session' } },
      {
        author: { type: 'agent', agentThreadId: firstThreads[0]!.agentThreadId },
        scope: { type: 'session' },
      },
    ]);
    const persisted = await assembly.di.sessionProvider.load(session.sessionId);
    persisted!.metadata.title = 'existing title';
    await assembly.di.sessionProvider.save(persisted!);

    let restoredConversation: string[] = [];
    const restarted = createAgentSystem(assembly, {
      createRootAgent: (params) => {
        restoredConversation = params.session.conversation.map((message) => message.role);
        return new REMAgent(params);
      },
    });
    terminal = waitForTerminal(restarted.events(), session.sessionId);
    await restarted.send({ sessionId: session.sessionId, content: 'two' });
    await terminal;
    const restoredThreads = await assembly.di.storage.agentThreadStore.listBySession(session.sessionId);
    expect(restoredThreads.map((thread) => thread.agentThreadId))
      .toEqual([firstThreads[0]!.agentThreadId]);
    expect(restoredConversation).toEqual(['user', 'assistant']);
    expect(contexts).toEqual([['user', 'assistant', 'user']]);
  });

  it('binds root tool history and one-shot child to inherited profiles', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('delegate_task', { task: 'research' })]),
      fauxAssistantMessage('child result'),
      fauxAssistantMessage('root final'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const system = createAgentSystem(assembly);
    const parent = await system.createSession({ workspace: 'ws' });
    const terminal = waitForTerminal(system.events(), parent.sessionId);
    await system.send({ sessionId: parent.sessionId, content: 'go' });
    await terminal;

    const parentThread = (await assembly.di.storage.agentThreadStore.listBySession(parent.sessionId))[0]!;
    const child = (await system.listSessions('ws')).find(
      (item) => item.parentSessionId === parent.sessionId,
    )!;
    const childThread = (await assembly.di.storage.agentThreadStore.listBySession(child.sessionId))[0]!;
    expect(childThread).toMatchObject({
      agentProfileId: parentThread.agentProfileId,
      role: 'delegated',
      lifecycle: 'one-shot',
    });

    const parentPayloads = messagePayloads(
      await assembly.di.sessionProvider.listEntries(parent.sessionId),
    );
    const toolResult = parentPayloads.find((payload) => payload.message.role === 'toolResult');
    expect(toolResult).toMatchObject({
      author: { type: 'tool', agentThreadId: parentThread.agentThreadId },
      scope: { type: 'thread', agentThreadId: parentThread.agentThreadId },
    });
    const childPayloads = messagePayloads(
      await assembly.di.sessionProvider.listEntries(child.sessionId),
    );
    expect(childPayloads[1]).toMatchObject({
      author: { type: 'agent', agentThreadId: childThread.agentThreadId },
      scope: { type: 'session' },
    });
  });
});
