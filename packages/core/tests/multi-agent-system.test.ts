import { describe, expect, it } from 'vitest';
import { createAgentSystem } from '../src/system/create-agent-system.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall, type ScriptedStep } from './helpers/scripted-models.js';

describe('AgentSystem multi-agent sessions', () => {
  it('creates Team Threads only when teamId is explicit and exposes read APIs', async () => {
    const assembly = await createFakeAssembly();
    assembly.di.configProvider.resolveAgent = (id) => {
      const agentId = id || 'default';
      return { id: agentId, name: agentId, corePrompt: `${agentId} prompt` };
    };
    assembly.di.configProvider.resolveTeam = (id) => {
      if (id !== 'engineering') throw new Error(`Unknown team: ${id}`);
      return { id, organizer: assembly.di.configProvider.resolveAgent('organizer'),
        members: [assembly.di.configProvider.resolveAgent('architect'), assembly.di.configProvider.resolveAgent('reviewer')] };
    };
    const system = createAgentSystem(assembly);

    const single = await system.createSession({ workspace: 'ws' });
    expect(single).toMatchObject({ mode: 'single' });
    expect(await system.getSessionThreads(single.sessionId)).toEqual([]);

    const team = await system.createSession({ workspace: 'ws', teamId: 'engineering' });
    expect(team).toMatchObject({ mode: 'multi-agent', teamId: 'engineering' });
    expect((await system.getSessionThreads(team.sessionId)).map(({ agentId, role }) => ({ agentId, role })))
      .toEqual([
        { agentId: 'organizer', role: 'organizer' },
        { agentId: 'architect', role: 'member' },
        { agentId: 'reviewer', role: 'member' },
      ]);
    expect(await system.getSessionChat(team.sessionId)).toEqual([]);
  });

  it('routes the user through Organizer, Member and Organizer finish', async () => {
    const responder: Exclude<ScriptedStep, AssistantMessage> = ({ context }) => {
      const serialized = JSON.stringify(context.messages);
      if (context.systemPrompt.includes('architect prompt')) return fauxAssistantMessage('architecture review');
      if (!serialized.includes('send_message')) {
        return fauxAssistantMessage([fauxToolCall('send_message', { to: ['architect'], content: 'please review' })]);
      }
      if (!serialized.includes('architecture review')) return fauxAssistantMessage('waiting for review');
      if (!serialized.includes('finish_discussion')) {
        return fauxAssistantMessage([fauxToolCall('finish_discussion', { answer: 'final answer' })]);
      }
      return fauxAssistantMessage('finishing');
    };
    const scripted = createScriptedModels(Array.from({ length: 10 }, () => responder));
    const assembly = await createFakeAssembly({ models: scripted.models });
    configureTeam(assembly.di.configProvider);
    const system = createAgentSystem(assembly);
    const session = await system.createSession({ workspace: 'ws', teamId: 'engineering' });

    await system.send({ sessionId: session.sessionId, content: 'design it' });

    const chat = await system.getSessionChat(session.sessionId);
    expect(scripted.state.callCount).toBeGreaterThanOrEqual(5);
    expect(chat.at(-1)?.message).toMatchObject({
      role: 'assistant', content: [{ type: 'text', text: 'final answer' }],
    });
    expect((await system.getSession(session.sessionId)).messageCount).toBeGreaterThanOrEqual(chat.length);
    const deliveries = await assembly.di.storage.messageDeliveryStore.listByRoot(
      session.sessionId, chat[0]!.messageId,
    );
    expect(deliveries.filter((item) => item.kind === 'resume')).toHaveLength(1);
    expect(deliveries.every((item) => item.status === 'completed')).toBe(true);
  });
});

function configureTeam(config: import('../src/sdk/config-provider.js').ConfigProvider): void {
  config.resolveAgent = (id) => {
    const agentId = id || 'default';
    return { id: agentId, name: agentId, corePrompt: `${agentId} prompt` };
  };
  config.resolveTeam = (id) => {
    if (id !== 'engineering') throw new Error(`Unknown team: ${id}`);
    return { id, organizer: config.resolveAgent('organizer'), members: [config.resolveAgent('architect')] };
  };
}
