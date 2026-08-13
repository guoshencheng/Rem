import { Type } from '@sinclair/typebox';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentRuntime } from '../src/assembly/agent-runtime-assembly.js';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { SqliteStorageProvider } from '../src/plugins/storage/sqlite/index.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

const request: RuntimeRequestContext = { tenantId: 'acme', principal: { principalId: 'operator-1', roles: ['member'] } };
const definition: AgentDefinition = {
  agentId: 'ticket-worker', revision: '1', name: 'Ticket Worker',
  instructions: '你是工单处理 Agent。', modelId: 'mock/mock-model',
  toolNames: ['acme_get_ticket'], acceptedTriggers: ['message'],
  optionalContexts: [{ type: 'acme/customer' }, { type: 'acme/repository' }],
  execution: { type: 'single-agent' },
};

const customerPlugin: RuntimePlugin = {
  manifest: { pluginId: 'acme-customer', version: '1' },
  register(registrar) {
    registrar.addContextType({
      type: 'acme/customer',
      resolve: async ({ binding }) => ({ snapshot: { customerId: binding.contextId } }),
      materialize: async (snapshot) => ({
        promptSections: [{ name: 'customer', priority: 1, content: `客户档案：${JSON.stringify(snapshot)}` }],
      }),
    });
  },
};

let toolCalls = 0;
const repositoryPlugin: RuntimePlugin = {
  manifest: { pluginId: 'acme-repository', version: '1' },
  register(registrar) {
    registrar.addContextType({
      type: 'acme/repository',
      resolve: async ({ binding }) => ({ snapshot: { repositoryId: binding.contextId } }),
      materialize: async () => ({
        tools: [{
          definition: {
            name: 'acme_get_ticket', description: '读取工单', sideEffect: 'none',
            parameters: Type.Object({ ticketId: Type.String() }),
          },
          executor: async () => {
            toolCalls += 1;
            const ticket = { ticketId: 'T-1001', state: 'open', title: '无法登录' };
            return { output: JSON.stringify(ticket), details: ticket };
          },
        }],
      }),
    });
  },
};

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('AgentRuntime 纵向切片验收', () => {
  it('静态 Definition + 两个 Context 插件 + 脚本模型走完一次 Run，重开 Runtime 后读到同一持久化结果', async () => {
    toolCalls = 0;
    const dir = mkdtempSync(join(tmpdir(), 'rem-runtime-acceptance-')); paths.push(dir);
    const dbPath = join(dir, 'runtime.db');
    // 第一段脚本：首个 Run 直接给出文本结论
    const scripted = createScriptedModels([fauxAssistantMessage('已了解客户背景。')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const agentDefinitions = new StaticAgentDefinitionProvider([definition]);
    const plugins = [customerPlugin, repositoryPlugin];

    const storageA = new SqliteStorageProvider({ dbPath });
    const runtime = createAgentRuntime({ agentDefinitions, plugins, storage: storageA, assembly, worker: { pollMs: 10 } });
    await runtime.initialize();
    const scoped = runtime.as(request);

    // Session 通过首个 Run 的 contexts add 建立 customer 绑定
    const first = await scoped.runs.start({
      agentId: 'ticket-worker', trigger: { type: 'message', content: '帮我处理客户工单' },
      contexts: { add: [{ type: 'acme/customer', contextId: 'cust-42' }] },
    });
    const firstFinished = await scoped.runs.waitForCompletion(first.runId);
    expect(firstFinished.status).toBe('completed');

    // 第二段脚本：调用 acme_get_ticket 后返回结构化结论
    scripted.setResponses([
      () => fauxAssistantMessage([fauxToolCall('acme_get_ticket', { ticketId: 'T-1001' })]),
      fauxAssistantMessage('{"ticketId":"T-1001","conclusion":"已重置密码并通知客户"}'),
    ]);

    // 复用同一 Session，Run 级 patch 增加 repository 绑定
    const run = await scoped.runs.start({
      agentId: 'ticket-worker', sessionId: first.sessionId,
      trigger: { type: 'message', content: '继续处理工单 T-1001' },
      contexts: { add: [{ type: 'acme/repository', contextId: 'repo-7' }] },
    });
    const completed = await scoped.runs.waitForCompletion(run.runId);
    expect(completed.status).toBe('completed');
    expect(toolCalls).toBe(1);

    const events = await scoped.runs.listEvents(run.runId);
    expect(events.map((event) => event.type)).toEqual([
      'run.created', 'run.started', 'tool.started', 'tool.succeeded',
      'artifact.created', 'run.completed',
    ]);
    const artifacts = await scoped.artifacts.listByRun(run.runId);
    expect(artifacts[0]).toMatchObject({ type: 'result', mediaType: 'text/plain' });

    await runtime.shutdown();
    await storageA.close();

    // 重开同一 SQLite 文件的全新 Runtime，验证持久化切片可读
    const storageB = new SqliteStorageProvider({ dbPath });
    const reopened = createAgentRuntime({ agentDefinitions, plugins, storage: storageB, assembly, worker: { pollMs: 10 } });
    await reopened.initialize();
    const reopenedRun = await reopened.as(request).runs.get(run.runId);
    expect(reopenedRun.status).toBe('completed');
    expect(reopenedRun.contextSnapshot.items.map((item) => item.binding.type)).toEqual([
      'acme/customer', 'acme/repository',
    ]);
    await reopened.shutdown();
    await storageB.close();
  }, 15000);
});
