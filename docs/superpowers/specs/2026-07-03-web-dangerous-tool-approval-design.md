# Web 危险工具审批设计

## 1. 目标与范围

### 目标
让 Web 聊天 UI 支持对 `dangerous: true` 的工具进行人工审批，替代当前 `autoApproveDangerous: true` 的自动通过行为。

### 范围
- Web 前端：新增审批条组件，展示待审批工具，提供「允许一次 / 始终允许 / 拒绝」操作。
- Bridge 层：扩展 `IAgentService` 和 `BusEvent`，把 Core 的审批状态暴露给前端，Bridge 本身不存储审批数据。
- Core 层：复用现有 `ApprovalManager` 和 dangerous hook；将 `ApprovalManager` 提升为独立 provider；为 `ToolContext` 增加 `sessionId`。
- 服务端配置：`packages/web/src/lib/container.ts` 移除 `autoApproveDangerous: true`，默认使用 `false`。

### 非范围
- TUI 端审批（后续再做）。
- 新增除 `dangerous` 以外的审批触发条件。
- 持久化用户「始终允许」决策到磁盘或配置（本次仅内存级）。
- 审批超时自定义 UI（沿用 Core 120 秒默认）。

## 2. 架构与数据流

```
┌─────────────────────────────────────────────────────────────┐
│  Web Frontend                                               │
│  ┌─────────────────┐   ┌─────────────────────────────────┐ │
│  │ useAgents hook  │──▶│ ApprovalBar (in Chatbox)        │ │
│  │                 │◀──│ 允许一次 / 始终允许 / 拒绝        │ │
│  └─────────────────┘   └─────────────────────────────────┘ │
│           ▲                                                │
│           │  BusEvent: approval-request / approval-resolved│
│           │  HTTP POST: /api/agent/approvals/:id/resolve   │
│           ▼                                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ AgentRemoteService (bridge/client)                       ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js API Routes (web)                                   │
│  POST /api/agent/approvals/:id/resolve                       │
│  GET  /api/agent/approvals?sessionId=...                     │
│  (delegate to AgentService)                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  AgentService (bridge/server)                                │
│  - listPendingApprovals(sessionId) ──▶ Core ApprovalManager │
│  - resolveApproval(approvalId, decision) ──▶ Core ApprovalManager│
│  - 转发 approval-request / approval-resolved BusEvent        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Core ProviderManager                                        │
│  - ApprovalManager registered as kind="approval"             │
│  - Injected into AgentToolRegistry                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Core AgentToolRegistry                                      │
│  - dangerous-tool hook creates ApprovalRequest               │
│  - ApprovalManager stores pending Map + Promise              │
│  - ToolHookRunner awaits decision, then executes or blocks   │
└─────────────────────────────────────────────────────────────┘
```

**核心原则**：审批状态只存在 Core 的 `ApprovalManager` 中，Bridge 和 Web 都不保存状态，只做转发和展示。

## 3. Core 层改动

### 3.1 `ApprovalManager` 提升为独立 provider

当前 `AgentToolRegistry` 内部直接 `new ApprovalManager()`。审批是跨工具/跨会话的通用能力，不应是 ToolRegistry 的私有依赖。

- `ProviderManager` 统一创建 `ApprovalManager` 实例。
- 在 provider registry 中注册为 `kind = "approval"`。
- `AgentToolRegistryOptions` 增加 `approvalManager: ApprovalManager`，由构造时注入。
- `AgentToolRegistry` 移除内部 `new ApprovalManager()`。

这样 Bridge 可以通过 `pm.require<ApprovalManager>('approval')` 直接操作同一个实例，无需经过 ToolProvider。

### 3.2 `ToolContext` 增加 `sessionId`

```ts
export interface ToolContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId?: string; // 新增
}
```

- `ReactLoop.iterate()` 构造 `toolCtx` 时填入 `ctx.sessionId`。
- `ToolHookContext` 自然继承，dangerous hook 触发审批时可将 `sessionId` 写入事件 payload。

### 3.3 Core 事件

通过现有 `EventBus` 发射：

- `tool:approval-request`
  - payload: `{ sessionId, approvalId, toolName, toolCallId, title, description, severity, allowedDecisions }`
- `tool:approval-resolved`
  - payload: `{ sessionId, approvalId, decision }`

`ToolHookRunner` 在创建审批请求时发射 `tool:approval-request`，在决议后发射 `tool:approval-resolved`。

### 3.4 `AgentToolRegistry` 暴露方法

- `resolveApproval(approvalId, decision): boolean` —— 调用内部注入的 `approvalManager.resolve()`。
- 不再对外暴露 `getApprovalManager()`。

## 4. Bridge 层改动

### 4.1 扩展 `IAgentService`

```ts
interface IAgentService {
  // ...existing methods
  listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>;
}
```

`ApprovalRequest` 与 `ApprovalDecision` 从 `rem-agent-core` 复用导出。

### 4.2 扩展 `BusEvent`

```ts
export type BusEvent =
  | // ...existing events
  | { workspace: string; sessionId: string; type: 'approval-request'; request: ApprovalRequest }
  | { workspace: string; sessionId: string; type: 'approval-resolved'; approvalId: string; decision: ApprovalDecision | null };
```

### 4.3 `AgentService` 实现

- 构造时从 `ProviderManager` 取出 `ApprovalManager`：`pm.require<ApprovalManager>('approval')`。
- `listPendingApprovals(sessionId)`：调用 `approvalManager.listPending()` 后按 `sessionId` 过滤。
- `resolveApproval(approvalId, decision)`：调用 `approvalManager.resolve()`。
- 通过 `EventBus` 监听 Core 的 `tool:approval-request` 与 `tool:approval-resolved`，转换为 `BusEvent` 并广播。

### 4.4 `AgentRemoteService` 客户端实现

- 实现 `listPendingApprovals` 与 `resolveApproval`，分别调用 HTTP API。
- `stream()` 正常透传 `approval-request` / `approval-resolved` BusEvent。

### 4.5 Web API 路由

- `GET /api/agent/approvals?sessionId=...`
  - 调用 `agentService.listPendingApprovals(sessionId)` 返回 JSON 数组。
- `POST /api/agent/approvals/:approvalId/resolve`
  - body: `{ decision: 'allow-once' | 'allow-always' | 'deny' }`
  - 调用 `agentService.resolveApproval(approvalId, decision)` 返回 `{ success: boolean }`。

## 5. Web 前端改动

### 5.1 `ApprovalBar` 组件

- 文件：`packages/web/src/components/chat/approval-bar.tsx`
- 位置：嵌在 `InputBox` 组件内部顶部（见 UI mockup）。
- Props：
  - `request: ApprovalRequest`
  - `onResolve(decision: ApprovalDecision): void`
  - `loading?: boolean`
- 展示内容：
  - 警告图标（颜色按 severity 区分：info / warning / critical）。
  - 工具名 + 目标参数摘要（如 `write src/index.ts`）。
  - 描述文字：「危险操作，需要你的确认」。
  - 三个按钮：拒绝 / 始终允许 / 允许一次。

### 5.2 `InputBox` 组件

- 接收 `pendingApproval?: ApprovalRequest`。
- 当有 pending approval 时：
  - 在输入框上方渲染 `ApprovalBar`。
  - 输入框显示占位提示「等待审批...」，发送按钮禁用或隐藏，避免用户发送新消息干扰当前工具执行流。

### 5.3 `useAgents` hook 扩展

- 状态新增 `pendingApprovals: Map<string, ApprovalRequest>`，以 `approvalId` 为 key，方便去重。
- 监听 bus 事件：
  - `approval-request`：如果当前会话匹配，加入 map。
  - `approval-resolved`：从 map 移除对应 `approvalId`。
- 暴露 `currentApproval: ApprovalRequest | undefined`，取 map 中第一个值（队列头部）。
- 暴露 `resolveApproval(approvalId, decision)`：调用 `agentService.resolveApproval`。
- 初始化 / SSE 重连时：调用 `agentService.listPendingApprovals(sessionId)`，恢复未处理的审批。
- 会话切换时：清空上一个会话的 pending approvals，重新拉取当前会话的。

### 5.4 页面状态

- 审批期间，Agent 处于「调用工具中」状态，activity 保持 `calling-function`。
- 用户拒绝或超时后，Core 会生成 tool-result（带错误），Web 通过现有 chunk 处理展示错误。

## 6. 服务端配置变更

`packages/web/src/lib/container.ts`：

```ts
// 移除 autoApproveDangerous: true
const { pm } = await createAgentFromEnv({ sessionProvider });
```

Core 默认 `autoApproveDangerous: false`，危险工具将进入审批流程。

## 7. 错误处理

| 场景 | 行为 |
|------|------|
| 审批超时（Core 120s） | `ApprovalManager` 自动 resolve 为 `null`，`ToolHookRunner` 视为拒绝，工具返回 `Approval timed out` 错误。 |
| 用户点击拒绝 | 立即 resolve 为 `deny`，工具返回 `Approval denied` 错误。 |
| 页面刷新 / SSE 重连 | `useAgents` 调用 `listPendingApprovals` 恢复未处理审批条。 |
| 会话切换 | 按 `sessionId` 过滤，只展示当前会话的审批。 |
| 用户点击允许一次 | resolve 为 `allow-once`，工具继续执行。 |
| 用户点击始终允许 | resolve 为 `allow-always`，本次工具继续执行；后续同工具是否自动通过本次不实现，留待持久化决策后支持。 |

## 8. 测试策略

### Core
- 验证 `ApprovalManager` 作为 provider 注入后，`AgentToolRegistry` 仍能正确阻塞/放行危险工具。
- 验证 `ToolContext.sessionId` 能传递到 dangerous hook 并进入审批事件。
- 验证 `tool:approval-request` / `tool:approval-resolved` 事件正确发射。

### Bridge
- 验证 `AgentService.listPendingApprovals` 按 sessionId 过滤。
- 验证 `AgentService.resolveApproval` 能正确调用 Core `ApprovalManager`。
- 验证 Core 的审批事件能正确转换为 `BusEvent` 广播。

### Web
- 验证危险工具触发时 `ApprovalBar` 渲染在输入框上方。
- 验证点击「允许一次」后工具继续执行并出现 tool-result。
- 验证点击「拒绝」后出现错误结果。
- 验证刷新页面后未处理审批条能恢复。
- 验证非当前会话的审批请求不会显示在当前会话。

## 9. UI 示意

审批条位于 Chatbox 内部、输入框上方，与输入框一体化：

```
┌─────────────────────────────────────────┐
│ ⚠ write 请求写入 src/index.ts           │
│   危险操作，需要你的确认                  │
│   [拒绝] [始终允许] [允许一次]            │
├─────────────────────────────────────────┤
│ 等待审批时无法发送新消息...          [发送]│
└─────────────────────────────────────────┘
```

Visual Companion mockup 保存在 `.superpowers/brainstorm/57452-1783059937/content/approval-bar-v2.html`。

## 10. 决策记录

- **审批状态存储位置**：仅 Core `ApprovalManager`，Bridge 和 Web 不保存。
- **交互位置**：Chatbox 内部顶部审批条，非全局底部固定条。
- **多审批排队**：一次只展示一个，解决后自动显示下一个。
- **`ApprovalManager` 归属**：提升为 Core 独立 provider，注入 `AgentToolRegistry`。
- **`ToolContext` 扩展**：新增 `sessionId?: string` 以支持按会话广播审批事件。
- **默认行为**：Web 服务端移除 `autoApproveDangerous: true`，默认启用人工审批。
