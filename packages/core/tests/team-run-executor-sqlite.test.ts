import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { TeamRunExecutor } from '../src/execution/team-run-executor.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

const at = new Date('2026-08-14T00:00:00.000Z');
const request: RuntimeRequestContext = { tenantId: 'tenant', principal: { principalId: 'operator', roles: ['member'] } };

function member(agentId: string, revision: string): AgentDefinition {
  return {
    agentId, revision, name: agentId, instructions: `Instructions for ${agentId}`,
    modelId: 'mock/mock-model', toolNames: [], acceptedTriggers: ['message'], execution: { type: 'single-agent' },
  };
}

function openStore(): { db: Database.Database; store: SqliteRuntimeStore } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  new SqliteSchemaManager(db).migrate();
  return { db, store: new SqliteRuntimeStore(db) };
}

describe('TeamRunExecutor SQLite graph persistence', () => {
  it('persists immutable participant nodes, deliveries and per-node journal entries', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('send_message', { to: ['member-a', 'member-b'], content: 'research' })]),
      fauxAssistantMessage('organizer waiting'), fauxAssistantMessage('first member'), fauxAssistantMessage('second member'),
      ({ context }) => {
        expect(context.messages.some((message) => message.role === 'assistant' && message.content.some((part) => part.type === 'text' && part.text === 'first member'))).toBe(true);
        expect(context.messages.some((message) => message.role === 'assistant' && message.content.some((part) => part.type === 'text' && part.text === 'second member'))).toBe(true);
        return fauxAssistantMessage('organizer result');
      },
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { db, store } = openStore();
    const first = member('member-a', '1');
    const second = member('member-b', '2');
    const team: AgentDefinition = {
      agentId: 'team', revision: '7', name: 'Team', instructions: 'Coordinate the members',
      modelId: 'mock/mock-model', toolNames: [], acceptedTriggers: ['message'],
      execution: { type: 'team', members: [{ agentId: first.agentId }, { agentId: second.agentId }] },
    };
    let id = 0;
    const start = new StartRunUsecase({
      storage: store, agentDefinitions: new StaticAgentDefinitionProvider([team, first, second]),
      contextResolver: new ContextResolver(new RuntimePluginHost()), now: () => at,
      generateId: () => ['session', 'run', 'event', 'work'][id++] ?? `generated-${id}`,
    });
    try {
      const created = await start.execute(request, { agentId: 'team', trigger: { type: 'message', content: 'coordinate' } });
      expect(created.executionType).toBe('team');
      expect(await store.listDeliveries(created.runId)).toHaveLength(1);
      const session = await store.getSession(created.sessionId);
      expect(session).not.toBeNull();
      const executor = new TeamRunExecutor({
        models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot,
        storage: store,
        agentDefinitions: new StaticAgentDefinitionProvider([team, first, second]),
        pluginHost: new RuntimePluginHost(),
      });
      await executor.execute({
        run: { ...created, status: 'running' }, session: session!, signal: new AbortController().signal,
      });
      const nodes = await store.listExecutionNodes(created.runId);
      expect(nodes.filter((node) => node.status === 'idle')).toHaveLength(3);
      expect(await store.listDeliveries(created.runId)).toHaveLength(4);
      expect((await store.listDeliveries(created.runId)).map((delivery) => delivery.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
      const entries = await store.listExecutionEntries(created.runId);
      expect(entries).toHaveLength(9);
      expect(new Set(entries.map((entry) => entry.nodeId))).toEqual(new Set(nodes.map((node) => node.nodeId)));
    } finally {
      db.close();
      await assembly.cleanup();
    }
  });
});
