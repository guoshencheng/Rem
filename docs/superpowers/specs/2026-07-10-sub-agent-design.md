# REM 子 Agent 支持设计

> 状态：待实现  
> 日期：2026-07-10  
> 方案：方案 A（内置工具 `delegate_task`）

---

## 1. 目标

让 REM 支持**层级委派**子 Agent：父 Agent 通过调用一个内置工具把任务派给子 Agent，子 Agent 独立运行并持有独立会话，父 Agent 只拿到最终结果后继续使用。

核心约束来自需求确认：

- 子 Agent 对外表现像普通工具调用，父 Agent 等待其完成后继续。
- 子 Agent 有独立且持久化的 sessionId，作为独立条目出现在 Web 侧边栏。
- 子 Agent 继承父 Agent 的模型、工具集、安全规则与 workspace。
- 子 Agent 的系统提示可覆盖，安全模式固定为 `auto`。
- 子 Agent 拥有独立预算（默认继承父 `maxTurns`）。
- 支持递归：子 Agent 也能继续创建子 Agent。
- 父 Agent 页面只显示子 Agent 的实时状态与 token 消耗；完整流在子会话页面查看。
- 子 Agent 结果以 XML 形式注入父会话。

---

## 2. 架构与新增模块

### 2.1 Core 层

新增内置工具 `delegate_task`，注册在 `DefaultToolComposer` 里（与 `read_skill` 同级）。

新增辅助模块：

- `packages/core/src/plugins/tool/builtin/delegate-task.ts`  
  工具定义 + executor 工厂。
- `packages/core/src/sub-agent/build-child-context.ts`  
  从父 `AgentContext` 派生子上下文。
- `packages/core/src/sub-agent/format-task-result.ts`  
  把子 Agent 输出包装成 XML。

### 2.2 Bridge 层

- `packages/bridge/src/types.ts`  
  扩展 `SessionSummary` 增加 `parentSessionId?: string`。
- `packages/core/src/bus-events.ts`  
  新增 `child-agent-update` 事件类型，用于向父会话推送子 Agent 状态。

### 2.3 Web 层

- `packages/web/src/components/chat/child-agent-card.tsx`  
  在父会话消息流中展示子 Agent 实时状态。
- `packages/web/src/lib/use-agents.ts`  
  处理 `child-agent-update`，维护 `childAgents` 列表。

---

## 3. 工具 schema

```typescript
{
  name: 'delegate_task',
  description: '把一项独立任务委派给子 Agent 执行。子 Agent 会拥有独立会话并继承当前 Agent 的模型和工具，运行完成后返回结果。',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: '要交给子 Agent 完成的任务描述，也会作为任务摘要展示。'
      },
      systemPrompt: {
        type: 'string',
        description: '可选：覆盖子 Agent 的系统提示。'
      },
      maxTurns: {
        type: 'number',
        description: '可选：子 Agent 的最大轮次，默认继承父 Agent 的 maxTurns。'
      }
    },
    required: ['task']
  }
}
```

---

## 4. 数据流

1. 父 Agent 在 ReAct 循环中调用 `delegate_task`。
2. 工具 executor 生成 `childSessionId`。
3. 用 `ctx.sessionProvider.create()` 创建子会话，写入元数据：
   - `parentSessionId` = 父 sessionId
   - `workspace` = 父 workspace
   - `title` = `task` 的前 50 字符
4. 调用 `buildChildContext(parentCtx, { maxTurns?, systemPrompt? })` 派生子上下文：
   - 继承 `toolProvider`、`mcpProviders`、`toolComposer`、`skillProvider`、`contextProvider`、`budgetPolicy`、`compressor`、`errorHandler`、`titleProvider`、`loopStrategy`、`ruleEngine`、`ruleStore`、`sessionProvider`。
   - `securityMode` 强制为 `'auto'`。
   - `maxTurns` 使用工具参数或父值。
5. 调用 `runAgent({ sessionId: childSessionId, input: { content: task }, ctx: childCtx, agentState: parentAgentState, workspace, workspaceRoot })`。
6. 工具 executor 通过 `parentAgentState.subscribe()` 监听子 sessionId 的 `usage-change` / `activity-change` / `session-end` / `session-error` 事件，过滤后向父 sessionId 发布 `child-agent-update` BusEvent；同时把父 Agent 的 `AbortSignal` 传给子 Agent，保证父 Agent 被中断时子 Agent 也结束。
7. 子 Agent 结束后，按如下 XML 格式返回：

```xml
<task id="{{childSessionId}}" state="completed">
  <summary>{{task}}</summary>
  <task_result>
    {{子 Agent 最终输出文本}}
  </task_result>
</task>
```

失败时 `state="failed"`，`<task_result>` 里放错误信息。

8. `executeTools` 把该 XML 作为 `tool-result` content part 追加到父会话的当前 assistant 消息，父 Agent 继续下一轮。

---

## 5. 子上下文派生规则

子 Agent 必须继承父 Agent 的模型与工具，但有几个关键覆盖项：

| 字段 | 来源 |
|------|------|
| `configProvider` | 继承，但 `maxTurns` 可被覆盖 |
| `securityMode` | 强制 `'auto'` |
| `permissionEvaluator` | 用 `createPermissionEvaluator('auto', ruleEngine)` 重新创建 |
| `toolProvider` / `mcpProviders` / `toolComposer` | 继承 |
| `skillProvider` / `contextProvider` / `systemPromptAssembler` | 继承 |
| `ruleEngine` / `ruleStore` | 继承 |
| `budgetPolicy` / `compressor` / `errorHandler` | 继承 |

`systemPrompt` 的覆盖逻辑：

- 如果工具参数提供了 `systemPrompt`，直接作为子 Agent 系统提示。
- 否则复用父 Agent 的系统提示。

---

## 6. BusEvent 扩展

新增事件类型 `child-agent-update`：

```typescript
{
  workspace: string;
  sessionId: string;        // 父会话 ID
  type: 'child-agent-update';
  childSessionId: string;
  summary: string;
  status: 'running' | 'completed' | 'failed';
  tokenUsage?: LanguageModelUsage;
}
```

该事件由工具 executor 在子 Agent 运行期间发布，Web 层据此更新父会话界面中的子 Agent 卡片。

---

## 7. Web UI 改动

### 7.1 `use-agents.ts`

`SessionState` 增加：

```typescript
childAgents: Map<string, {
  childSessionId: string;
  summary: string;
  status: 'running' | 'completed' | 'failed';
  tokenUsage?: LanguageModelUsage;
}>;
```

处理 `child-agent-update` 事件时更新该 Map。

### 7.2 `ChildAgentCard` 组件

在父会话消息流中，每个子 Agent 显示一个卡片：

- 任务摘要
- 状态（running / completed / failed）
- 累计 token 数
- 点击跳转到子会话

### 7.3 侧边栏

`SessionSummary` 增加 `parentSessionId?: string`。子会话作为独立条目出现在侧边栏。后续可在 UI 上给子会话条目加一个小标识或分组，但当前阶段保持独立条目即可。

---

## 8. 错误处理

- 子 Agent 运行过程中抛错或返回 `error` chunk：工具返回 `state="failed"` 的 XML，`<task_result>` 包含错误信息。
- 子 Agent 预算耗尽：子 Agent 自行结束并返回 `Budget exceeded.`，父 Agent 把该文本作为 tool result。
- 父 Agent 被中断：父 Agent 的 `AbortSignal` 应传递给子 Agent，子 Agent 也会收到 abort 并结束。

---

## 9. 预算与安全

- 子 Agent 使用独立 `IterationBudget`，不消耗父 Agent 预算。
- `maxTurns` 默认继承父 Agent，可通过工具参数覆盖。
- `securityMode` 固定为 `'auto'`，即读/写工具按规则自动放行，不触发人工审批。
- `ruleEngine` 与 `ruleStore` 继承父 Agent，用户配置的安全规则继续生效。

---

## 10. 测试计划

### Core 层

- `delegate_task` 工具能创建子会话并正确写入 `parentSessionId`。
- 子上下文 `securityMode` 为 `'auto'`。
- 子 Agent 运行完成后返回 XML 字符串。
- 子 Agent 失败时返回 `state="failed"` 的 XML。
- 递归调用：子 Agent 再次调用 `delegate_task` 能创建孙会话。

### Bridge 层

- 验证 `child-agent-update` 事件在父 sessionId 上发布。
- 验证 `SessionSummary` 包含 `parentSessionId`。

### Web 层

- 验证 `use-agents` 能根据 `child-agent-update` 更新 `childAgents` 状态。
- 验证 `ChildAgentCard` 正确渲染状态与 token 数。

---

## 11. 未来扩展点

当前方案 A 已把子 Agent 生命周期封装在工具 executor 中。若未来需要支持并行或工作流，可：

- 在工具 schema 里增加 `mode` 字段（`sync` / `parallel` / `workflow`）。
- 或在 `DefaultToolComposer` 里新增 `delegate_tasks` / `run_workflow` 工具。
- 由于子 Agent 通过 `runAgent` 直接启动，现有代码已具备向多个子 Agent 扩展的基础。

---

## 12. 文件清单

### 新建

- `packages/core/src/plugins/tool/builtin/delegate-task.ts`
- `packages/core/src/sub-agent/build-child-context.ts`
- `packages/core/src/sub-agent/format-task-result.ts`
- `packages/web/src/components/chat/child-agent-card.tsx`

### 修改

- `packages/core/src/tool-composer.ts`  
  注册 `delegate_task` 工具。
- `packages/core/src/bus-events.ts`  
  新增 `child-agent-update`。
- `packages/bridge/src/types.ts`  
  `SessionSummary` 增加 `parentSessionId`。
- `packages/bridge/src/agent-session.ts`  
  从 session metadata 读取 `parentSessionId` 并写入 summary。
- `packages/web/src/lib/use-agents.ts`  
  处理 `child-agent-update`。
- `packages/web/src/components/chat/message-item.tsx`  
  渲染 `ChildAgentCard`。
- `packages/web/src/components/sidebar/session-item.tsx`  
  可选：显示子会话标识。

---

*设计完成，等待进入实现计划。*
