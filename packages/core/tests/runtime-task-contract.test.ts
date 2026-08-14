import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const request: RuntimeRequestContext = { tenantId: 'tenant-1', principal: { principalId: 'operator', roles: ['member'] } };
const base = (changes: Partial<AgentDefinition> = {}): AgentDefinition => ({
  agentId: 'worker', revision: '1', name: 'Worker', instructions: 'Do work', modelId: 'mock/model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' }, ...changes,
});

function start(definitions: AgentDefinition[]) {
  return createFakeRuntimeStore().then(({ store }) => ({
    store,
    usecase: new StartRunUsecase({
      storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider(definitions),
      contextResolver: new ContextResolver(new RuntimePluginHost()),
      generateId: (() => { let n = 0; return () => `id-${++n}`; })(),
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    }),
  }));
}

describe('Runtime task contract', () => {
  it('在创建 Run 前按 Draft 2020-12 Schema 校验 task input，并返回安全 JSON Pointer', async () => {
    const { usecase, store } = await start([base({ inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
      required: ['ticketId'], properties: { ticketId: { type: 'string', minLength: 2 } }, additionalProperties: false,
    } })]);
    await expect(usecase.execute(request, { agentId: 'worker', trigger: { type: 'task', input: { ticketId: 1 } } }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', details: { pointer: '/ticketId' } });
    expect(await store.getRun('id-2')).toBeNull();
  });

  it('将输入规范化并持久化不可变 single-agent execution plan', async () => {
    const { usecase } = await start([base({ outputSchema: { type: 'object', required: ['answer'] } })]);
    const run = await usecase.execute(request, { agentId: 'worker', trigger: { type: 'task', input: { answer: 'ok' } } });
    expect(run.executionType).toBe('single-agent');
    expect(run.executionPlanSnapshot).toMatchObject({
      executionType: 'single-agent', participants: [{ agentId: 'worker', revision: '1', role: 'root' }],
      outputSchema: { type: 'object', required: ['answer'] },
    });
    expect(run.executionPlanSnapshot?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('team 在 startRun 时固化成员 revision，并拒绝嵌套 team', async () => {
    const member = base({ agentId: 'member', revision: '3', name: 'Member' });
    const team = base({ execution: { type: 'team', members: [{ agentId: 'member' }] } });
    const { usecase } = await start([team, member]);
    const run = await usecase.execute(request, { agentId: 'worker', trigger: { type: 'task', input: {} } });
    expect(run.executionType).toBe('team');
    expect(run.executionPlanSnapshot?.participants).toEqual([
      { agentId: 'worker', revision: '1', role: 'organizer' },
      { agentId: 'member', revision: '3', role: 'member' },
    ]);
  });

  it('Schema 本身非法时不创建 Run', async () => {
    const { usecase } = await start([base({ inputSchema: { type: 'not-a-json-type' } })]);
    await expect(usecase.execute(request, { agentId: 'worker', trigger: { type: 'task', input: {} } }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('在创建 Run 前拒绝超过 Team agent-run 预算的执行计划', async () => {
    const first = base({ agentId: 'member-a', revision: '1' });
    const second = base({ agentId: 'member-b', revision: '1' });
    const team = base({ execution: {
      type: 'team', members: [{ agentId: first.agentId }, { agentId: second.agentId }], limits: { maxAgentRuns: 2 },
    } });
    const { usecase, store } = await start([team, first, second]);
    await expect(usecase.execute(request, { agentId: 'worker', trigger: { type: 'task', input: {} } }))
      .rejects.toMatchObject({ code: 'RUN_CONFLICT', details: { reason: 'maxAgentRuns', max: 2, actual: 3 } });
    await expect(store.getRun('id-2')).resolves.toBeNull();
  });
});
