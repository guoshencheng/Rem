import { describe, expect, it } from 'vitest';
import { REMAgent } from '../src/agent/rem-agent.js';
import type { AgentSystemEvent } from '../src/agent/bus-events.js';
import { createAgentSystem } from '../src/system/create-agent-system.js';
import { SessionAlreadyRunningError } from '../src/system/errors.js';
import { fauxAssistantMessage } from './helpers/scripted-models.js';
import { createScriptedModels } from './helpers/scripted-models.js';
import { createFakeAssembly } from './helpers/fake-di.js';

async function waitForTerminal(
  events: AsyncIterable<AgentSystemEvent>,
  sessionId: string,
): Promise<AgentSystemEvent[]> {
  const seen: AgentSystemEvent[] = [];
  for await (const event of events) {
    if (event.sessionId !== sessionId) continue;
    seen.push(event);
    if (event.type === 'session-end' || event.type === 'session-error') return seen;
  }
  return seen;
}

describe('AgentSystem', () => {
  it('同一 Session 连续发送复用 root Agent 并延续 transcript', async () => {
    const seenRoles: string[][] = [];
    const scripted = createScriptedModels([
      ({ context }) => {
        seenRoles.push(context.messages.map((message) => message.role));
        return fauxAssistantMessage('first reply');
      },
      ({ context }) => {
        seenRoles.push(context.messages.map((message) => message.role));
        return fauxAssistantMessage('second reply');
      },
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    let agentCreations = 0;
    const system = createAgentSystem(assembly, {
      createRootAgent: (params) => {
        agentCreations += 1;
        return new REMAgent(params);
      },
    });
    const session = await system.createSession({ workspace: 'ws' });

    let terminal = waitForTerminal(system.events(), session.sessionId);
    await system.send({ sessionId: session.sessionId, content: 'first' });
    expect((await terminal).at(-1)?.type).toBe('session-end');
    terminal = waitForTerminal(system.events(), session.sessionId);
    await system.send({ sessionId: session.sessionId, content: 'second' });
    await terminal;

    expect(agentCreations).toBe(1);
    expect(seenRoles).toEqual([['user'], ['user', 'assistant', 'user']]);
    const persisted = await assembly.di.sessionProvider.load(session.sessionId);
    expect(persisted?.conversation).toHaveLength(4);
  });

  it('不同 Session 隔离；新 AgentSystem 从持久化历史重建', async () => {
    const contexts: string[][] = [];
    const scripted = createScriptedModels([
      fauxAssistantMessage('a1'),
      ({ context }) => {
        contexts.push(context.messages.map((message) => message.role));
        return fauxAssistantMessage('b1');
      },
      ({ context }) => {
        contexts.push(context.messages.map((message) => message.role));
        return fauxAssistantMessage('a2');
      },
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const firstSystem = createAgentSystem(assembly);
    const first = await firstSystem.createSession({ workspace: 'ws' });
    const second = await firstSystem.createSession({ workspace: 'ws' });
    let terminal = waitForTerminal(firstSystem.events(), first.sessionId);
    await firstSystem.send({ sessionId: first.sessionId, content: 'a' });
    await terminal;
    terminal = waitForTerminal(firstSystem.events(), second.sessionId);
    await firstSystem.send({ sessionId: second.sessionId, content: 'b' });
    await terminal;
    const persistedFirst = await assembly.di.sessionProvider.load(first.sessionId);
    expect(persistedFirst?.conversation).toHaveLength(2);
    persistedFirst!.metadata.title = 'existing title';
    await assembly.di.sessionProvider.save(persistedFirst!);

    let restartConversation: string[] = [];
    const restarted = createAgentSystem(assembly, {
      createRootAgent: (params) => {
        restartConversation = params.session.conversation.map((message) => message.role);
        return new REMAgent(params);
      },
    });
    terminal = waitForTerminal(restarted.events(), first.sessionId);
    await restarted.send({ sessionId: first.sessionId, content: 'again' });
    await terminal;
    expect(restartConversation).toEqual(['user', 'assistant']);
    expect(contexts).toEqual([['user'], ['user', 'assistant', 'user']]);
  });

  it('拒绝并发 send，interrupt 收尾后可再次运行', async () => {
    const scripted = createScriptedModels([
      ({ signal }) => new Promise((resolve) => {
        const finish = () => resolve(fauxAssistantMessage('stopped'));
        if (signal?.aborted) finish();
        else signal?.addEventListener('abort', finish, { once: true });
      }),
      fauxAssistantMessage('recovered'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const system = createAgentSystem(assembly);
    const session = await system.createSession({ workspace: 'ws' });
    let terminal = waitForTerminal(system.events(), session.sessionId);
    await system.send({ sessionId: session.sessionId, content: 'long' });
    await expect(system.send({ sessionId: session.sessionId, content: 'overlap' }))
      .rejects.toBeInstanceOf(SessionAlreadyRunningError);
    await system.interrupt(session.sessionId);
    await terminal;
    terminal = waitForTerminal(system.events(), session.sessionId);
    await system.send({ sessionId: session.sessionId, content: 'retry' });
    expect((await terminal).at(-1)?.type).toBe('session-end');
  });

  it('listTeams delegates to config provider', async () => {
    const assembly = await createFakeAssembly({ models: createScriptedModels([]).models });
    const system = createAgentSystem(assembly);
    expect(await system.listTeams()).toEqual([]);
  });

  it('单 Agent chunk 事件携带 agentThreadId', async () => {
    const scripted = createScriptedModels([() => fauxAssistantMessage('hi')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const system = createAgentSystem(assembly);
    const session = await system.createSession({ workspace: 'ws' });

    const terminal = waitForTerminal(system.events(), session.sessionId);
    await system.send({ sessionId: session.sessionId, content: 'hello' });
    const events = await terminal;
    const threads = await system.getSessionThreads(session.sessionId);

    const chunks = events.filter((e) => e.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(threads.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.agentThreadId).toBe(threads[0].agentThreadId);
    }
  });
});
