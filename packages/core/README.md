# rem-agent-core

Rem Agent 的核心包：完整 Agent Harness 的唯一活动实现。除旧 `AgentSystem` 路径外，本包提供以持久化 Run 为中心的新执行模型 `AgentRuntime`。

## 最小示例（不依赖 Workspace）

以下示例只用静态 AgentDefinition、一个 Context 插件和临时 SQLite 文件，完成一次 Run 并等待结果：

```typescript
import { Type } from '@sinclair/typebox';
import {
  createAgentRuntime,
  SqliteStorageProvider,
  StaticAgentDefinitionProvider,
  type AgentDefinition,
  type RuntimePlugin,
} from 'rem-agent-core';

// 1. 静态 AgentDefinition（ticket-worker@1）
const definition: AgentDefinition = {
  agentId: 'ticket-worker', revision: '1', name: 'Ticket Worker',
  instructions: '你是工单处理 Agent。', modelId: 'openai/gpt-5',
  toolNames: ['acme_get_ticket'], acceptedTriggers: ['message'],
  execution: { type: 'single-agent' },
};

// 2. Context 插件：解析 acme/customer 绑定，贡献 Prompt 与工具
const acmePlugin: RuntimePlugin = {
  manifest: { pluginId: 'acme', version: '1' },
  register(registrar) {
    registrar.addContextType({
      type: 'acme/customer',
      resolve: async ({ binding }) => ({ snapshot: { customerId: binding.contextId } }),
      materialize: async () => ({
        promptSections: [{ name: 'customer', priority: 1, content: '客户档案：…' }],
        tools: [{
          definition: {
            name: 'acme_get_ticket', description: '读取工单',
            parameters: Type.Object({ ticketId: Type.String() }),
          },
          executor: async ({ ticketId }) => ({ output: JSON.stringify({ ticketId, state: 'open' }) }),
        }],
      }),
    });
  },
};

// 3. 装配：注入 Storage 时其生命周期归调用方
const storage = new SqliteStorageProvider({ dbPath: './runtime.db' });
const runtime = createAgentRuntime({
  agentDefinitions: new StaticAgentDefinitionProvider([definition]),
  plugins: [acmePlugin],
  storage,
});
await runtime.initialize();

// 4. 发起 Run 并等待完成；contexts add 会写入新建 Session 的绑定
const scoped = runtime.as({ tenantId: 'acme', principal: { principalId: 'operator-1', roles: [] } });
const run = await scoped.runs.start({
  agentId: 'ticket-worker',
  trigger: { type: 'message', content: '帮我处理工单 T-1001' },
  contexts: { add: [{ type: 'acme/customer', contextId: 'cust-42' }] },
});
const completed = await scoped.runs.waitForCompletion(run.runId);
console.log(completed.status, await scoped.artifacts.listByRun(run.runId));

// 5. 关闭：Runtime 只停止 Worker，注入的 Storage 由调用方关闭
await runtime.shutdown();
await storage.close();
```

要点：

- `runs.start` 在单个事务内写入 Session（新建时）、Run、`run.created` 事件与 WorkItem；之后由内置 `LocalRunWorker` 异步执行。
- 复用同一 Session 时传 `sessionId`，`contexts` 补丁只作用于该 Run 的快照。
- 事件流（`scoped.runs.listEvents`）与 Run 状态是唯一事实；关闭后可用同一 SQLite 文件重新装配 Runtime 读取历史 Run。

## 开发命令

| 命令 | 作用 |
|---|---|
| `pnpm build` | 构建 Core |
| `pnpm typecheck` | 类型检查 |
| `pnpm test` | 运行测试 |
| `pnpm check:structure` | 模块边界与文件大小检查 |

更多设计见 `docs/architecture.md` 与 `docs/module-reference.md`。
