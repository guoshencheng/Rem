# Web 危险工具审批设计

## 1. 目标与范围

### 目标
让 Web 聊天 UI 支持对 `dangerous: true` 的工具进行人工审批，替代当前 `autoApproveDangerous: true` 的自动通过行为。

### 范围
- Web 前端：新增审批条组件，展示待审批工具，提供「允许一次 / 始终允许 / 拒绝」操作。
- Bridge 层：实现 `AgentStateProvider` 注入 Core；扩展 `IAgentService` 提供审批 API；新增 Web API 路由。
- Core 层：
  - 引入 `AgentStateProvider` 抽象，用于保存 Agent 运行时状态（含 pending 审批）。
  - 引入 `ApprovalOrchestrator`，由 Core 控制审批的阻塞、流式事件推送和恢复。
  - 扩展 `AgentStreamChunk` 支持 `approval-request` / `approval-resolved`。
  - `ToolHookRunner` 在危险工具执行前调用 `ApprovalOrchestrator`。
  - `ToolProvider.execute` 可接收 stream emitter，用于推送审批 chunk。
- 服务端配置：`packages/web/src/lib/container.ts` 移除 `autoApproveDangerous: true`，默认使用 `false`。

### 非范围
- TUI 端审批（后续再做）。
- 新增除 `dangerous` 以外的审批触发条件。
- 持久化用户「始终允许」决策到磁盘或配置（本次仅内存级，但状态持久化 provider 为未来扩展预留）。
- 审批超时自定义 UI（沿用 Core 120 秒默认）。
- 工具注册 Provider、工具执行校验 Provider 的完整重构（本次仅预留位置，核心改动在审批链路）。

## 2. 核心设计原则

1. **Core 控制完整执行流程**：外部只负责接入（状态持久化实现、UI 展示、用户操作回调）。
2. **审批状态通过 `AgentStateProvider` 持久化**：Core 定义接口，Bridge 实现，支持页面刷新后恢复。
3. **审批事件通过 `AgentStreamChunk` 走流式通道**：不依赖 EventBus 或 Bridge `BroadcastBus`，Web 从 SSE stream 直接接收。
4. **Bridge 不保存审批业务状态**：只保存 Core 通过 `AgentStateProvider` 写入的状态，以及提供 `resolveApproval` API。

## 3. 架构与数据流

```
Web Frontend
├─ SSE stream ← 收到 approval-request / approval-resolved chunk
├─ ApprovalBar (in Chatbox) 显示审批条
└─ 点击按钮 → POST /api/agent/approvals/:id/resolve

Next.js API Routes
├─ POST /api/agent/approvals/:id/resolve → AgentService.resolveApproval()
└─ GET  /api/agent/approvals?sessionId=... → AgentService.listPendingApprovals()

Bridge AgentService (singleton)
├─ BridgeAgentStateProvider implements AgentStateProvider
│   ├─ 内存 Map 保存 session → AgentRuntimeState
│   ├─ 内存 Map 保存 approvalId → resolver callback
│   └─ resolveApproval() 时执行 resolver 唤醒 Core Promise
├─ ApprovalOrchestrator (Core 定义，Bridge 创建实例并注入 Core)
│   ├─ requestApproval() 时
│   │   ├─ stateProvider.setState() 保存 pending
│   │   ├─ emitChunk({ type: 'approval-request' }) 推送流式事件
│   │   └─ await 一个 Promise，该 Promise 通过 stateProvider.registerPendingApproval() 注册 resolver
│   └─ resolveApproval() 时
│       ├─ stateProvider.setState() 移除 pending
│       ├─ stateProvider.resolveApproval() 执行 resolver，唤醒上面 await 的 Promise
│       └─ emitChunk({ type: 'approval-resolved' }) 推送流式事件
└─ 转发 AgentStreamChunk 到 SSE

Core ProviderManager
├─ 'tool' → AgentToolRegistry (file-system)
├─ 'approval' → ApprovalOrchestrator (Bridge 注入)
└─ 'state' → AgentStateProvider (Bridge 注入)

Core ReactLoop / ToolHookRunner
└─ toolProvider.execute(calls, toolCtx, emitChunk)
    └─ AgentToolRegistry.execute()
        └─ ToolHookRunner.run()
            ├─ 校验工具是否存在
            ├─ ToolPolicyProvider 校验权限
            └─ 若 dangerous：ApprovalOrchestrator.requestApproval()
                └─ 等待用户决策后继续/拒绝
```

## 4. Core 层改动

### 4.1 新增 `AgentStateProvider` 抽象

文件：`packages/core/src/sdk/agent-state-provider.ts`

```ts
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export interface ApprovalRequest {
  approvalId: string;
  toolName: string;
  toolCallId?: string;
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  allowedDecisions: ApprovalDecision[];
  timeoutMs?: number;
  sessionId?: string;
}

export interface AgentRuntimeState {
  pendingApprovals: ApprovalRequest[];
}

export interface AgentStateProvider {
  getState(sessionId: string): Promise<AgentRuntimeState>;
  setState(sessionId: string, state: AgentRuntimeState): Promise<void>;

  // Core 注册等待回调；Bridge 实现时保存 resolver
  registerPendingApproval(approvalId: string, resolver: (decision: ApprovalDecision | null) => void): void;

  // Bridge 调用以触发 Core 等待的 resolver
  resolveApproval(approvalId: string, decision: ApprovalDecision | null): boolean;
}
```

### 4.2 新增 `ApprovalOrchestrator`

文件：`packages/core/src/security/approval-orchestrator.ts`

职责：
- 生成审批请求 ID。
- 调用 `AgentStateProvider` 保存 pending。
- 通过 emitter 发送 `approval-request` / `approval-resolved` chunk。
- 阻塞工具执行，等待 `resolveApproval()` 唤醒。
- 超时后自动以 `null` 决议。

核心方法：

```ts
export interface ApprovalChunkEmitter {
  emit(chunk: AgentStreamChunk): void;
}

export class ApprovalOrchestrator {
  constructor(private stateProvider: AgentStateProvider) {}

  async requestApproval(
    ctx: ToolHookContext,
    requirement: ApprovalRequirement,
    emit: ApprovalChunkEmitter,
  ): Promise<ApprovalDecision | null>;

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>;

  async listPending(sessionId?: string): Promise<ApprovalRequest[]>;
}
```

### 4.3 扩展 `AgentStreamChunk`

文件：`packages/core/src/types.ts` 或相关 stream 类型文件

```ts
export type AgentStreamChunk =
  | // ...existing chunks
  | { type: 'approval-request'; sessionId: string; request: ApprovalRequest }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; decision: ApprovalDecision | null };
```

### 4.4 `ToolProvider` 与 `ToolHookRunner` 支持 emitter

`ToolContext` 增加 `sessionId`：

```ts
export interface ToolContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId?: string;
}
```

`ToolProvider.execute` 签名扩展：

```ts
export interface ToolProvider {
  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void;
  getToolSet(): ToolSet;
  execute(
    calls: ToolCall[],
    ctx: ToolContext,
    emit?: ApprovalChunkEmitter,
  ): Promise<ToolResult[]>;
}
```

`ToolHookRunner` 构造时接收 `ApprovalOrchestrator` 和 emitter，危险工具触发时调用：

```ts
const decision = await this.approvalOrchestrator.requestApproval(ctx, result.requireApproval, this.emitter);
if (decision !== 'allow-once' && decision !== 'allow-always') {
  return { blocked: { reason: 'Approval denied' } };
}
```

### 4.5 `AgentToolRegistry` 注入 `ApprovalOrchestrator`

```ts
export interface AgentToolRegistryOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  policy?: ToolPolicyConfig;
  hooks?: ToolHook[];
  approvalOrchestrator?: ApprovalOrchestrator;
}
```

当 `autoApproveDangerous === true` 或没有 `approvalOrchestrator` 时，危险工具自动通过（保持向后兼容）。

### 4.6 `ReactLoop` 传入 sessionId 和 emitter

- `LoopContext` 增加 `sessionId?: string`。
- `ReactLoop.iterate()` 构造 `toolCtx` 时传入 `sessionId`。
- `toolProvider.execute()` 调用时传入 emitter：
  ```ts
  const toolResults = await this.toolProvider.execute(inferResult.toolCalls, toolCtx, {
    emit: (chunk) => controller.append(chunk),
  });
  ```

### 4.7 `ProviderManager` 暴露 `register()` 方法

`ProviderManager` 需要支持外部注册已实例化的 provider：

```ts
export class ProviderManager {
  register<T>(kind: string, provider: T): void {
    this.registry.register(kind as ProviderKind, provider);
  }
}
```

同时 `AgentProviderRegistry` 增加 `register(kind, provider)` 方法，直接写入 `providers` Map。

这样 Bridge `AgentService` 构造时可以把 `ApprovalOrchestrator` 和 `BridgeAgentStateProvider` 注册到 Core。

## 5. Bridge 层改动

### 5.1 新增 `BridgeAgentStateProvider`

文件：`packages/bridge/src/agent-state-provider.ts`

```ts
export class BridgeAgentStateProvider implements AgentStateProvider {
  private states = new Map<string, AgentRuntimeState>();
  private resolvers = new Map<string, (decision: ApprovalDecision | null) => void>();

  async getState(sessionId: string): Promise<AgentRuntimeState> {
    return this.states.get(sessionId) ?? { pendingApprovals: [] };
  }

  async setState(sessionId: string, state: AgentRuntimeState): Promise<void> {
    this.states.set(sessionId, state);
  }

  registerPendingApproval(approvalId: string, resolver: (decision: ApprovalDecision | null) => void): void {
    this.resolvers.set(approvalId, resolver);
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision | null): boolean {
    const resolver = this.resolvers.get(approvalId);
    if (!resolver) return false;
    resolver(decision);
    this.resolvers.delete(approvalId);
    return true;
  }
}
```

### 5.2 `AgentService` 创建并注入 `ApprovalOrchestrator`

```ts
export class AgentService implements IAgentService {
  private approvalOrchestrator: ApprovalOrchestrator;

  constructor(private providerManager: ProviderManager, workspace = 'default') {
    // ... existing init
    const stateProvider = new BridgeAgentStateProvider();
    this.approvalOrchestrator = new ApprovalOrchestrator(stateProvider);
    
    // 注册到 Core provider registry
    this.providerManager.register('approval', this.approvalOrchestrator);
    this.providerManager.register('state', stateProvider);
  }

  async listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
    return this.approvalOrchestrator.listPending(sessionId);
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    return this.approvalOrchestrator.resolveApproval(approvalId, decision);
  }
}
```

### 5.3 扩展 `IAgentService`

```ts
export interface IAgentService {
  // ...existing methods
  listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>;
}
```

### 5.4 `AgentRemoteService` 客户端实现

```ts
async listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
  const res = await fetch(`${this.baseUrl}/api/agent/approvals?sessionId=${encodeURIComponent(sessionId)}`);
  return res.json();
}

async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
  const res = await fetch(`${this.baseUrl}/api/agent/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  const data = await res.json() as { success: boolean };
  return data.success;
}
```

### 5.5 Web API 路由

- `GET /api/agent/approvals?sessionId=...`
  - 调用 `agentService.listPendingApprovals(sessionId)`。
- `POST /api/agent/approvals/:approvalId/resolve`
  - body: `{ decision: 'allow-once' | 'allow-always' | 'deny' }`
  - 调用 `agentService.resolveApproval(approvalId, decision)`。

## 6. Web 前端改动

### 6.1 `ApprovalBar` 组件

文件：`packages/web/src/components/chat/approval-bar.tsx`

位置：嵌在 `InputBox` 内部顶部。

Props：
- `request: ApprovalRequest`
- `onResolve(decision: ApprovalDecision): void`

展示：工具名、描述、severity 图标、三个按钮。

### 6.2 `useAgents` hook 扩展

- 监听 stream chunk：
  - `approval-request`：加入当前 session 的 pending approvals。
  - `approval-resolved`：从 pending approvals 移除。
- 暴露 `currentApproval` 和 `resolveApproval(approvalId, decision)`。
- 初始化 / SSE 重连 / 切换会话时调用 `listPendingApprovals` 恢复。

### 6.3 `InputBox` 组件

- 接收 `pendingApproval` 和 `onResolveApproval`。
- pending 时禁用输入框，显示占位提示，渲染 `ApprovalBar`。

### 6.4 `ChatPanel` / page 连接

把 `currentApproval` 和 `resolveApproval` 从 `useAgents` 传到 `ChatPanel` → `InputBox`。

## 7. 服务端配置变更

`packages/web/src/lib/container.ts` 移除 `autoApproveDangerous: true`：

```ts
const { pm } = await createAgentFromEnv({ sessionProvider });
```

Core 默认 `autoApproveDangerous: false`，危险工具将进入审批流程。

## 8. 审批执行流程

1. 用户发送消息。
2. LLM 返回 tool call，例如 `write src/index.ts`。
3. `ReactLoop` 调用 `toolProvider.execute(calls, toolCtx, emitChunk)`。
4. `AgentToolRegistry.execute()` 逐个处理 tool call：
   - 校验工具存在。
   - `ToolPolicyProvider` 校验权限。
   - 若工具 `dangerous=true`：
     - `ApprovalOrchestrator.requestApproval()`
     - 保存 pending 到 `AgentStateProvider`
     - `emitChunk({ type: 'approval-request' })`
     - `await stateProvider.waitForDecision()`（通过 `registerPendingApproval` + `resolveApproval` 实现）
5. Web 收到 `approval-request` chunk，显示审批条。
6. 用户点击「允许一次」：
   - Web → `POST /api/agent/approvals/:id/resolve`
   - `AgentService.resolveApproval()` → `ApprovalOrchestrator.resolveApproval()`
   - `stateProvider.resolveApproval()` 执行 resolver，Promise 决议
   - `emitChunk({ type: 'approval-resolved' })`
7. Core 继续执行 `write` 工具，返回 tool-result。

## 9. 错误处理

| 场景 | 行为 |
|------|------|
| 审批超时 | `ApprovalOrchestrator` 超时后自动以 `null` 决议，工具返回 `Approval timed out` 错误。 |
| 用户拒绝 | `decision = 'deny'`，工具返回 `Approval denied` 错误。 |
| 页面刷新 / SSE 重连 | `useAgents` 调用 `listPendingApprovals` 恢复未处理审批条。 |
| 会话切换 | 按 `sessionId` 过滤，只展示当前会话的审批。 |

## 10. 迭代拆分

### 迭代 1：Core 审批抽象
- 新增 `AgentStateProvider` 接口。
- 新增 `ApprovalOrchestrator`。
- 扩展 `AgentStreamChunk`。
- `ToolHookRunner` 集成审批。
- `ToolProvider.execute` 支持 emitter。
- `AgentToolRegistry` 注入 `ApprovalOrchestrator`。
- `LoopContext` / `ToolContext` 增加 `sessionId`。

### 迭代 2：Bridge 状态持久化 + AgentService API
- 新建 `BridgeAgentStateProvider`。
- `AgentService` 创建并注入 `ApprovalOrchestrator`。
- `ProviderManager` 暴露 `register()` 方法。
- 扩展 `IAgentService`。
- 实现 `AgentRemoteService` 客户端方法。
- 新增 Web API 路由。

### 迭代 3：Web UI
- 新建 `ApprovalBar`。
- 扩展 `useAgents`。
- `InputBox` 集成。
- 移除 `autoApproveDangerous: true`。

## 11. 决策记录

- **审批状态持久化**：通过 Core `AgentStateProvider` 抽象，Bridge 实现内存级版本。
- **审批事件通道**：通过 `AgentStreamChunk` 走 SSE stream，不额外依赖 EventBus 或 Bridge `BroadcastBus`。
- **阻塞机制**：Core `ApprovalOrchestrator` 自己阻塞，`AgentStateProvider` 传递 resolver 回调。
- **Bridge 角色**：实现状态持久化、提供审批 API、转发 stream chunk。
- **Core 角色**：控制完整执行流程，包括工具校验、审批阻塞、流式事件推送。
- **工具注册/校验 Provider 化**：本次预留位置，核心改动聚焦审批链路；后续迭代再重构 ToolRegistryProvider / ToolPolicyProvider。
