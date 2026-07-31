import { describe, expect, it } from 'vitest';
import { REMAgent } from '../src/agent/rem-agent.js';
import type { AgentSystemEvent } from '../src/agent/bus-events.js';
import { createAgentSystem } from '../src/system/create-agent-system.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

async function collectTerminal(
  events: AsyncIterable<AgentSystemEvent>, sessionId: string,
): Promise<AgentSystemEvent[]> {
  const seen: AgentSystemEvent[] = [];
  for await (const event of events) {
    seen.push(event);
    if (event.sessionId === sessionId && (event.type === 'session-end' || event.type === 'session-error')) break;
  }
  return seen;
}

describe('AgentSystem delegation', () => {
  it('root 委派独立 child Session，完成后继续回答且不长期持有 child', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('delegate_task', { task: 'research' })]),
      fauxAssistantMessage('child result'),
      fauxAssistantMessage('root final'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const agents: REMAgent[] = [];
    const system = createAgentSystem(assembly, {
      createRootAgent: (params) => {
        const agent = new REMAgent(params);
        agents.push(agent);
        return agent;
      },
    });
    const parent = await system.createSession({ workspace: 'ws' });
    const terminal = collectTerminal(system.events(), parent.sessionId);
    await system.send({ sessionId: parent.sessionId, content: 'go' });
    const events = await terminal;

    const sessions = await system.listSessions('ws');
    const childInfo = sessions.find((item) => item.parentSessionId === parent.sessionId);
    expect(childInfo).toBeDefined();
    const child = await assembly.di.sessionProvider.load(childInfo!.sessionId);
    const persistedParent = await assembly.di.sessionProvider.load(parent.sessionId);
    expect(child?.conversation).toHaveLength(2);
    expect(child?.metadata.delegationStatus).toBe('completed');
    expect(persistedParent?.conversation).toHaveLength(4);
    expect(agents).toHaveLength(2);
    expect('children' in agents[0]).toBe(false);
    expect(events.filter((event) => event.type === 'child-agent-update').map((event) => event.status))
      .toEqual(['running', 'completed']);
  });

  it('超出最大深度不创建孙 Session，child 仍可完成', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('delegate_task', { task: 'level one' })]),
      fauxAssistantMessage([fauxToolCall('delegate_task', { task: 'too deep' })]),
      fauxAssistantMessage('child handled limit'),
      fauxAssistantMessage('root final'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const system = createAgentSystem(assembly, { delegation: { maxDepth: 1 } });
    const parent = await system.createSession({ workspace: 'ws' });
    const terminal = collectTerminal(system.events(), parent.sessionId);
    await system.send({ sessionId: parent.sessionId, content: 'go' });
    await terminal;
    const sessions = await system.listSessions('ws');
    expect(sessions.filter((item) => item.parentSessionId)).toHaveLength(1);
  });

  it('递归委派的孙 child 指向直接 child Session', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('delegate_task', { task: 'level one' })]),
      fauxAssistantMessage([fauxToolCall('delegate_task', { task: 'level two' })]),
      fauxAssistantMessage('grandchild result'),
      fauxAssistantMessage('child result'),
      fauxAssistantMessage('root final'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const system = createAgentSystem(assembly);
    const parent = await system.createSession({ workspace: 'ws' });
    const terminal = collectTerminal(system.events(), parent.sessionId);
    await system.send({ sessionId: parent.sessionId, content: 'go' });
    await terminal;
    const sessions = await system.listSessions('ws');
    const child = sessions.find((item) => item.parentSessionId === parent.sessionId)!;
    const grandchild = sessions.find((item) => item.parentSessionId === child.sessionId)!;
    expect(grandchild).toBeDefined();
    expect((await assembly.di.sessionProvider.load(grandchild.sessionId))?.metadata.delegationDepth).toBe(2);
  });

  it('父 interrupt 级联中断 child 并持久化 interrupted', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('delegate_task', { task: 'wait' })]),
      ({ signal }) => new Promise((resolve) => {
        const finish = () => resolve(fauxAssistantMessage('stopped'));
        if (signal?.aborted) finish();
        else signal?.addEventListener('abort', finish, { once: true });
      }),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const system = createAgentSystem(assembly);
    const parent = await system.createSession({ workspace: 'ws' });
    const iterator = system.events()[Symbol.asyncIterator]();
    const firstEvent = iterator.next();
    await system.send({ sessionId: parent.sessionId, content: 'go' });
    let event = (await firstEvent).value!;
    while (!(event.type === 'child-agent-update' && event.status === 'running')) {
      event = (await iterator.next()).value!;
    }
    const childSessionId = event.childSessionId;
    await system.interrupt(parent.sessionId);
    while (!(event.sessionId === parent.sessionId && (event.type === 'session-end' || event.type === 'session-error'))) {
      event = (await iterator.next()).value!;
    }
    await iterator.return?.();
    expect((await assembly.di.sessionProvider.load(childSessionId))?.metadata.delegationStatus)
      .toBe('interrupted');
  });

  it('首次用例把遗留 running delegation 修复为 interrupted', async () => {
    const assembly = await createFakeAssembly();
    const parent = await assembly.di.sessionProvider.create();
    parent.metadata.workspace = 'ws';
    await assembly.di.sessionProvider.save(parent);
    const child = await assembly.di.sessionProvider.create();
    Object.assign(child.metadata, {
      workspace: 'ws', type: 'delegation', delegationStatus: 'running',
      parentSessionId: parent.sessionId, parentToolCallId: 'tc-1', delegationDepth: 1,
    });
    await assembly.di.sessionProvider.save(child);
    const system = createAgentSystem(assembly);
    await system.getSession(parent.sessionId);
    expect((await assembly.di.sessionProvider.load(child.sessionId))?.metadata.delegationStatus)
      .toBe('interrupted');
  });
});
