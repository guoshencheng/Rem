# Web 危险工具审批实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 聊天 UI 支持对 `dangerous: true` 工具进行人工审批；Core 控制完整执行流程，通过 `AgentStateProvider` 持久化状态，审批事件通过 `AgentStreamChunk` 走 SSE stream。

**Architecture:** Core 新增 `AgentStateProvider` 接口和 `ApprovalOrchestrator`，`ToolHookRunner` 在危险工具前调用 orchestrator 阻塞并推送流式事件；Bridge 实现内存级 `AgentStateProvider` 并注入 orchestrator，提供审批 API；Web 接收审批 chunk 显示审批条并回调 resolve。

**Tech Stack:** TypeScript, Next.js 15, React 19, Tailwind CSS 4, vitest

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `packages/core/src/sdk/agent-state-provider.ts` | `AgentStateProvider`、`ApprovalRequest`、`ApprovalDecision` 类型定义 |
| `packages/core/src/security/approval-orchestrator.ts` | Core 审批编排器：阻塞、emit chunk、resolve |
| `packages/core/src/sdk/tool-provider.ts` | `ToolContext` 增加 `sessionId`；`ToolProvider.execute` 增加 emitter |
| `packages/core/src/sdk/tool-hook.ts` | 已有，`ToolHookResult.requireApproval` |
| `packages/core/src/security/tool-hook-runner.ts` | 集成 `ApprovalOrchestrator`，危险工具时阻塞 |
| `packages/core/src/registry/tool-registry.ts` | 注入 `ApprovalOrchestrator`；向后兼容无 orchestrator |
| `packages/core/src/registry/provider-registry.ts` | 增加 `register(kind, provider)` 方法 |
| `packages/core/src/provider-manager.ts` | 暴露 `register()` 方法 |
| `packages/core/src/loop-types.ts` | `LoopContext` 增加 `sessionId` |
| `packages/core/src/loop-strategy.ts` | 传 `sessionId` 和 emitter给 `toolProvider.execute` |
| `packages/core/src/types.ts` | 扩展 `AgentStreamChunk` |
| `packages/core/tests/tool-registry.test.ts` | 更新测试，注入 mock orchestrator |
| `packages/bridge/src/agent-state-provider.ts` | `BridgeAgentStateProvider` 实现 |
| `packages/bridge/src/agent-service.interface.ts` | 扩展 `IAgentService` |
| `packages/bridge/src/agent.ts` | 创建/注入 orchestrator，实现审批 API |
| `packages/bridge/src/agent-remote-service.ts` | 客户端调用审批 API |
| `packages/bridge/src/index.ts` | 导出新增类型 |
| `packages/web/src/app/api/agent/approvals/route.ts` | `GET /api/agent/approvals` |
| `packages/web/src/app/api/agent/approvals/[id]/resolve/route.ts` | `POST /api/agent/approvals/:id/resolve` |
| `packages/web/src/components/chat/approval-bar.tsx` | 审批条 UI |
| `packages/web/src/components/chat/input-box.tsx` | 集成审批条 |
| `packages/web/src/lib/use-agents.ts` | 维护 pending approvals |
| `packages/web/src/lib/container.ts` | 移除 `autoApproveDangerous: true` |

---

## 迭代 1：Core 审批抽象

### Task 1: 新增 `AgentStateProvider` 类型

**Files:**
- Create: `packages/core/src/sdk/agent-state-provider.ts`

- [ ] **Step 1: 创建文件并导出类型**

```typescript
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
  registerPendingApproval(approvalId: string, resolver: (decision: ApprovalDecision | null) => void): void;
  resolveApproval(approvalId: string, decision: ApprovalDecision | null): boolean;
}
```

- [ ] **Step 2: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sdk/agent-state-provider.ts
```

---

### Task 2: 扩展 `AgentStreamChunk`

**Files:**
- Modify: `packages/core/src/types.ts`（或定义 `AgentStreamChunk` 的文件）

先确认 `AgentStreamChunk` 定义位置：

Run: `rg "type AgentStreamChunk" packages/core/src`

假设在 `packages/core/src/types.ts`：

- [ ] **Step 1: 增加审批相关 chunk 类型**

```typescript
export type AgentStreamChunk =
  | // ...existing chunks
  | { type: 'approval-request'; sessionId: string; request: ApprovalRequest }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; decision: ApprovalDecision | null };
```

- [ ] **Step 2: 在 `packages/core/src/index.ts` 导出 `ApprovalRequest` 和 `ApprovalDecision`**

```typescript
export type { ApprovalRequest, ApprovalDecision, AgentRuntimeState, AgentStateProvider } from './sdk/agent-state-provider.js';
```

- [ ] **Step 3: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
```

---

### Task 3: 新增 `ApprovalOrchestrator`

**Files:**
- Create: `packages/core/src/security/approval-orchestrator.ts`

- [ ] **Step 1: 实现 `ApprovalOrchestrator`**

```typescript
import { generateId } from '../shared/generate-id.js';
import type { AgentStateProvider, ApprovalRequest, ApprovalDecision } from '../sdk/agent-state-provider.js';
import type { AgentStreamChunk } from '../types.js';
import type { ToolHookContext } from '../sdk/tool-hook.js';

export interface ApprovalRequirement {
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  allowedDecisions: ApprovalDecision[];
  timeoutMs?: number;
}

export interface ApprovalChunkEmitter {
  emit(chunk: AgentStreamChunk): void;
}

export class ApprovalOrchestrator {
  constructor(private stateProvider: AgentStateProvider) {}

  async requestApproval(
    ctx: ToolHookContext,
    requirement: ApprovalRequirement,
    emit: ApprovalChunkEmitter,
  ): Promise<ApprovalDecision | null> {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      throw new Error('sessionId is required for approval');
    }

    const approvalId = `approval:${generateId()}`;
    const request: ApprovalRequest = {
      approvalId,
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      title: requirement.title,
      description: requirement.description,
      severity: requirement.severity ?? 'warning',
      allowedDecisions: requirement.allowedDecisions,
      timeoutMs: requirement.timeoutMs ?? 120_000,
      sessionId,
    };

    const state = await this.stateProvider.getState(sessionId);
    await this.stateProvider.setState(sessionId, {
      pendingApprovals: [...state.pendingApprovals, request],
    });

    emit.emit({ type: 'approval-request', sessionId, request });

    return new Promise<ApprovalDecision | null>((resolve) => {
      const timer = setTimeout(() => {
        this.stateProvider.resolveApproval(approvalId, null);
        resolve(null);
      }, request.timeoutMs);

      this.stateProvider.registerPendingApproval(approvalId, (decision) => {
        clearTimeout(timer);
        resolve(decision);
      });
    });
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    const state = await this.findStateByApprovalId(approvalId);
    if (!state) return false;

    const { sessionId, current } = state;
    const success = this.stateProvider.resolveApproval(approvalId, decision);
    if (!success) return false;

    await this.stateProvider.setState(sessionId, {
      pendingApprovals: current.pendingApprovals.filter((r) => r.approvalId !== approvalId),
    });

    return true;
  }

  async listPending(sessionId?: string): Promise<ApprovalRequest[]> {
    if (!sessionId) return [];
    const state = await this.stateProvider.getState(sessionId);
    return state.pendingApprovals;
  }

  private async findStateByApprovalId(approvalId: string): Promise<{ sessionId: string; current: { pendingApprovals: ApprovalRequest[] } } | undefined> {
    // BridgeAgentStateProvider 是内存实现，可以优化；先遍历所有 state
    // 实际实现中，BridgeAgentStateProvider 可增加 getAllStates 方法
    return undefined;
  }
}
```

> 注意：`findStateByApprovalId` 需要 `AgentStateProvider` 提供遍历能力，或者 `ApprovalOrchestrator` 自己维护 approvalId → sessionId 映射。更简洁的方式是在 `ApprovalOrchestrator` 内部维护一个 Map。

- [ ] **Step 2: 优化 `ApprovalOrchestrator`，内部维护 approvalId → sessionId 映射**

```typescript
export class ApprovalOrchestrator {
  private approvalToSession = new Map<string, string>();

  async requestApproval(ctx, requirement, emit): Promise<ApprovalDecision | null> {
    // ... 生成 request
    this.approvalToSession.set(request.approvalId, sessionId);
    // ...
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    const sessionId = this.approvalToSession.get(approvalId);
    if (!sessionId) return false;

    const success = this.stateProvider.resolveApproval(approvalId, decision);
    if (!success) return false;

    const state = await this.stateProvider.getState(sessionId);
    await this.stateProvider.setState(sessionId, {
      pendingApprovals: state.pendingApprovals.filter((r) => r.approvalId !== approvalId),
    });

    // 发送 resolved chunk：需要 emitter，但 resolveApproval 没有 emit 参数
    // 这个 resolved chunk 谁来发？见 Task 4

    this.approvalToSession.delete(approvalId);
    return true;
  }
}
```

- [ ] **Step 3: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: 可能有未完成的类型问题，先记录，继续 Task 4

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/security/approval-orchestrator.ts
```

---

### Task 4: `ApprovalOrchestrator.resolveApproval` 如何发送 `approval-resolved` chunk

**问题**：`requestApproval` 有 `emit` 参数，但 `resolveApproval` 是从 Bridge API 调用的，没有 emit 上下文。

**解决方案**：`ApprovalOrchestrator` 内部为每个 pending approval 保存对应的 emitter，resolve 时使用。

- [ ] **Step 1: 修改 `ApprovalOrchestrator` 保存 emitter**

```typescript
export class ApprovalOrchestrator {
  private approvalToSession = new Map<string, string>();
  private emitters = new Map<string, ApprovalChunkEmitter>();

  async requestApproval(ctx, requirement, emit): Promise<ApprovalDecision | null> {
    // ...
    this.approvalToSession.set(request.approvalId, sessionId);
    this.emitters.set(request.approvalId, emit);
    emit.emit({ type: 'approval-request', sessionId, request });

    return new Promise<ApprovalDecision | null>((resolve) => {
      const timer = setTimeout(() => {
        this.stateProvider.resolveApproval(approvalId, null);
        resolve(null);
      }, request.timeoutMs);

      this.stateProvider.registerPendingApproval(approvalId, (decision) => {
        clearTimeout(timer);
        resolve(decision);
      });
    });
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    const sessionId = this.approvalToSession.get(approvalId);
    const emit = this.emitters.get(approvalId);
    if (!sessionId) return false;

    const success = this.stateProvider.resolveApproval(approvalId, decision);
    if (!success) return false;

    const state = await this.stateProvider.getState(sessionId);
    await this.stateProvider.setState(sessionId, {
      pendingApprovals: state.pendingApprovals.filter((r) => r.approvalId !== approvalId),
    });

    if (emit) {
      emit.emit({ type: 'approval-resolved', sessionId, approvalId, decision });
    }

    this.approvalToSession.delete(approvalId);
    this.emitters.delete(approvalId);
    return true;
  }
}
```

- [ ] **Step 2: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/security/approval-orchestrator.ts
```

---

### Task 5: `ToolContext` 增加 `sessionId`，`ToolProvider.execute` 增加 emitter

**Files:**
- Modify: `packages/core/src/sdk/tool-provider.ts`
- Modify: `packages/core/src/sdk/tool-hook.ts`（若需要）

- [ ] **Step 1: 修改 `ToolContext`**

```typescript
export interface ToolContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId?: string;
}
```

- [ ] **Step 2: 修改 `ToolProvider.execute` 签名**

```typescript
import type { ApprovalChunkEmitter } from './security/approval-orchestrator.js';

export interface ToolProvider {
  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void;
  getToolSet(): ToolSet;
  execute(calls: ToolCall[], ctx: ToolContext, emit?: ApprovalChunkEmitter): Promise<ToolResult[]>;
}
```

- [ ] **Step 3: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: 可能有其他实现 `ToolProvider` 的地方需要更新

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sdk/tool-provider.ts
```

---

### Task 6: 更新 `AgentToolRegistry` 注入 `ApprovalOrchestrator`

**Files:**
- Modify: `packages/core/src/registry/tool-registry.ts`
- Modify: `packages/core/src/plugins/tool/in-memory/index.ts`

- [ ] **Step 1: 修改 `AgentToolRegistryOptions` 和构造函数**

```typescript
import type { ApprovalOrchestrator } from '../security/approval-orchestrator.js';

export interface AgentToolRegistryOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  policy?: ToolPolicyConfig;
  hooks?: ToolHook[];
  approvalOrchestrator?: ApprovalOrchestrator;
}

export class AgentToolRegistry implements ToolProvider {
  private approvalOrchestrator?: ApprovalOrchestrator;

  constructor(options: AgentToolRegistryOptions) {
    // ... existing init
    this.approvalOrchestrator = options.approvalOrchestrator;
  }
}
```

- [ ] **Step 2: 修改 `execute` 方法签名并传给 `ToolHookRunner`**

```typescript
async execute(calls: ToolCall[], ctx: ToolContext, emit?: ApprovalChunkEmitter): Promise<ToolResult[]> {
  // ...
  const hookOutcome = await this.hookRunner.run(
    { ...ctx, toolName: call.toolName, toolCallId: call.toolCallId, input: call.input },
    this.approvalOrchestrator,
    emit,
  );
  // ...
}
```

- [ ] **Step 3: 修改 `ToolHookRunner` 构造函数和 `run` 方法**

```typescript
export interface ToolHookRunnerOptions {
  hooks?: ToolHook[];
  approvalOrchestrator?: ApprovalOrchestrator;
}

export class ToolHookRunner {
  constructor(private options: ToolHookRunnerOptions) {}

  async run(ctx: ToolHookContext, approvalOrchestrator?: ApprovalOrchestrator, emit?: ApprovalChunkEmitter): Promise<ToolHookRunOutcome> {
    // ...
    if (result.requireApproval) {
      if (!approvalOrchestrator) {
        return { blocked: { reason: 'Approval orchestrator not available' } };
      }
      const decision = await approvalOrchestrator.requestApproval(ctx, result.requireApproval, emit ?? { emit: () => {} });
      // ...
    }
  }
}
```

- [ ] **Step 4: 更新 `AgentToolRegistry` 的 `getToolSet` 和测试**

`AgentToolRegistry` 现在实现了新的 `execute` 签名，需要确保所有调用方兼容。

- [ ] **Step 5: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/registry/tool-registry.ts packages/core/src/security/tool-hook-runner.ts
```

---

### Task 7: `LoopContext` 增加 `sessionId`，`ReactLoop` 传给工具调用

**Files:**
- Modify: `packages/core/src/loop-types.ts`
- Modify: `packages/core/src/loop-strategy.ts`

- [ ] **Step 1: 修改 `LoopContext`**

```typescript
export interface LoopContext {
  input?: UserInput;
  state: AgentState;
  systemPrompt: string;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: { apiKey: string; baseURL?: string; model: string };
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string; // 新增
}
```

- [ ] **Step 2: 修改 `ReactLoop.iterate()`**

```typescript
const toolCtx: ToolContext = {
  cwd: ctx.workspaceRoot,
  workspaceRoot: ctx.workspaceRoot,
  signal: ctx.signal,
  agentName: ctx.agentName,
  readOnly: ctx.readOnly,
  sessionId: ctx.sessionId,
};

const toolResults = await this.toolProvider.execute(inferResult.toolCalls, toolCtx, {
  emit: (chunk) => controller.append(chunk),
});
```

- [ ] **Step 3: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/loop-types.ts packages/core/src/loop-strategy.ts
```

---

### Task 8: `runAgent` 传入 `sessionId`

**Files:**
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: 在 `turnRunner.run` 的 context 中增加 `sessionId`**

```typescript
const result = await turnRunner.run(
  {
    // ... existing fields
    sessionId: params.sessionId,
  },
  createTurnHooks(state),
  controller,
);
```

- [ ] **Step 2: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/run-agent.ts
```

---

### Task 9: 更新 Core 测试

**Files:**
- Modify: `packages/core/tests/tool-registry.test.ts`
- Modify: `packages/core/tests/approval-manager.test.ts`（若存在且需要）

- [ ] **Step 1: 更新 `tool-registry.test.ts` 中的构造**

由于 `AgentToolRegistry` 的 `execute` 签名变了，但测试可能没有传 `emit`，需要确认测试仍能编译通过。

- [ ] **Step 2: 新增 `approval-orchestrator.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { ApprovalOrchestrator } from '../src/security/approval-orchestrator.js';
import type { AgentStateProvider, ApprovalDecision } from '../src/sdk/agent-state-provider.js';

function createMockStateProvider(): AgentStateProvider {
  const states = new Map<string, { pendingApprovals: any[] }>();
  const resolvers = new Map<string, (decision: ApprovalDecision | null) => void>();

  return {
    getState: async (sessionId) => states.get(sessionId) ?? { pendingApprovals: [] },
    setState: async (sessionId, state) => states.set(sessionId, state),
    registerPendingApproval: (id, resolver) => resolvers.set(id, resolver),
    resolveApproval: (id, decision) => {
      const resolver = resolvers.get(id);
      if (!resolver) return false;
      resolver(decision);
      resolvers.delete(id);
      return true;
    },
  };
}

describe('ApprovalOrchestrator', () => {
  it('requests approval and emits chunk', async () => {
    const stateProvider = createMockStateProvider();
    const orchestrator = new ApprovalOrchestrator(stateProvider);
    const chunks: any[] = [];

    const promise = orchestrator.requestApproval(
      { toolName: 'write', toolCallId: 'tc1', input: {}, cwd: '/', workspaceRoot: '/', sessionId: 's1' },
      { title: 'Write', allowedDecisions: ['allow-once', 'deny'] },
      { emit: (chunk) => chunks.push(chunk) },
    );

    const pending = await orchestrator.listPending('s1');
    expect(pending).toHaveLength(1);
    expect(chunks[0]?.type).toBe('approval-request');

    orchestrator.resolveApproval(pending[0].approvalId, 'allow-once');
    const decision = await promise;
    expect(decision).toBe('allow-once');
  });
});
```

- [ ] **Step 3: 运行 Core 测试**

Run: `pnpm --filter rem-agent-core test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests
```

---

## 迭代 2：Bridge 状态持久化 + AgentService API

### Task 10: 新增 `BridgeAgentStateProvider`

**Files:**
- Create: `packages/bridge/src/agent-state-provider.ts`

- [ ] **Step 1: 实现 `BridgeAgentStateProvider`**

```typescript
import type { AgentStateProvider, AgentRuntimeState, ApprovalDecision, ApprovalRequest } from 'rem-agent-core';

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

- [ ] **Step 2: 运行 Bridge 类型检查**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/agent-state-provider.ts
```

---

### Task 11: `ProviderManager` 和 `AgentProviderRegistry` 暴露 `register()`

**Files:**
- Modify: `packages/core/src/provider-manager.ts`
- Modify: `packages/core/src/registry/provider-registry.ts`

- [ ] **Step 1: `AgentProviderRegistry.register()`**

```typescript
register<T>(kind: ProviderKind, provider: T): void {
  this.providers.set(kind, provider);
}
```

- [ ] **Step 2: `ProviderManager.register()`**

```typescript
register<T>(kind: string, provider: T): void {
  this.registry.register(kind as ProviderKind, provider);
}
```

- [ ] **Step 3: 运行 Core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/provider-manager.ts packages/core/src/registry/provider-registry.ts
```

---

### Task 12: `AgentService` 创建并注入 `ApprovalOrchestrator`

**Files:**
- Modify: `packages/bridge/src/agent.ts`

- [ ] **Step 1: 修改构造函数**

```typescript
import { ApprovalOrchestrator } from 'rem-agent-core';
import { BridgeAgentStateProvider } from './agent-state-provider.js';

export class AgentService implements IAgentService {
  private approvalOrchestrator: ApprovalOrchestrator;

  constructor(private providerManager: ProviderManager, workspace = 'default') {
    // ... existing init
    const stateProvider = new BridgeAgentStateProvider();
    this.approvalOrchestrator = new ApprovalOrchestrator(stateProvider);
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

- [ ] **Step 2: 运行 Bridge 类型检查**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: 可能报错因为 `IAgentService` 还没扩展，继续 Task 13

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/agent.ts
```

---

### Task 13: 扩展 `IAgentService` 和 `AgentRemoteService`

**Files:**
- Modify: `packages/bridge/src/agent-service.interface.ts`
- Modify: `packages/bridge/src/agent-remote-service.ts`
- Modify: `packages/bridge/src/index.ts`

- [ ] **Step 1: 扩展接口**

```typescript
import type { ApprovalRequest, ApprovalDecision } from 'rem-agent-core';

export interface IAgentService {
  // ...existing methods
  listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>;
}
```

- [ ] **Step 2: `AgentRemoteService` 实现**

```typescript
async listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
  const response = await fetch(`${this.baseUrl}/api/agent/approvals?sessionId=${encodeURIComponent(sessionId)}`);
  if (!response.ok) throw new Error(`Failed to list approvals: ${response.status}`);
  return (await response.json()) as ApprovalRequest[];
}

async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
  const response = await fetch(`${this.baseUrl}/api/agent/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  if (!response.ok) throw new Error(`Failed to resolve approval: ${response.status}`);
  const data = (await response.json()) as { success: boolean };
  return data.success;
}
```

- [ ] **Step 3: 导出类型**

```typescript
export type { ApprovalRequest, ApprovalDecision } from 'rem-agent-core';
```

- [ ] **Step 4: 运行 Bridge 类型检查**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/agent-service.interface.ts packages/bridge/src/agent-remote-service.ts packages/bridge/src/index.ts
```

---

### Task 14: 新增 Web API 路由

**Files:**
- Create: `packages/web/src/app/api/agent/approvals/route.ts`
- Create: `packages/web/src/app/api/agent/approvals/[id]/resolve/route.ts`

- [ ] **Step 1: `GET /api/agent/approvals`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const approvals = await agentService.listPendingApprovals(sessionId);
    return NextResponse.json(approvals);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: `POST /api/agent/approvals/:id/resolve`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { IAgentService, ApprovalDecision } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json() as { decision?: ApprovalDecision };
    if (!body.decision || !['allow-once', 'allow-always', 'deny'].includes(body.decision)) {
      return NextResponse.json({ error: 'decision is required' }, { status: 400 });
    }
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const success = await agentService.resolveApproval(id, body.decision);
    return NextResponse.json({ success });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: 运行 Web 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 可能有未实现的 UI 部分报错，先确认路由本身无错

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/api/agent/approvals
```

---

## 迭代 3：Web UI

### Task 15: 创建 `ApprovalBar` 组件

**Files:**
- Create: `packages/web/src/components/chat/approval-bar.tsx`

- [ ] **Step 1: 实现组件**

```typescript
'use client';

import { ShieldAlert, Shield, ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApprovalRequest, ApprovalDecision } from 'rem-agent-bridge';

interface ApprovalBarProps {
  request: ApprovalRequest;
  onResolve: (decision: ApprovalDecision) => void;
}

const severityIcons = {
  info: Shield,
  warning: ShieldAlert,
  critical: ShieldX,
};

export function ApprovalBar({ request, onResolve }: ApprovalBarProps) {
  const Icon = severityIcons[request.severity ?? 'warning'];

  return (
    <div className="rounded-t-card border border-b-0 border-warn/30 bg-warn-bg p-3">
      <div className="flex items-center gap-3">
        <Icon size={18} className="text-warn flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-tx">{request.title}</div>
          {request.description && (
            <div className="text-xs text-tx3">{request.description}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onResolve('deny')}
            className="px-2.5 py-1 rounded-chip text-xs font-medium bg-card2 text-tx2 hover:bg-err-bg hover:text-err transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={() => onResolve('allow-always')}
            className="px-2.5 py-1 rounded-chip text-xs font-medium bg-card2 text-tx2 hover:bg-card transition-colors"
          >
            始终允许
          </button>
          <button
            onClick={() => onResolve('allow-once')}
            className="px-2.5 py-1 rounded-chip text-xs font-medium bg-ac text-white hover:bg-ac/90 transition-colors"
          >
            允许一次
          </button>
        </div>
      </div>
    </div>
  );
}
```

> 颜色类需与项目现有 Tailwind token 对齐。若 `text-warn` / `bg-warn-bg` 等不存在，请替换为现有等效类。

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/approval-bar.tsx
```

---

### Task 16: 扩展 `useAgents`

**Files:**
- Modify: `packages/web/src/lib/use-agents.ts`

- [ ] **Step 1: 在 `SessionState` 中增加 pending approvals**

```typescript
interface SessionState {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingToolCalls: Set<string>;
  pendingApprovals: Map<string, ApprovalRequest>;
}
```

- [ ] **Step 2: 初始化时创建 Map**

```typescript
sessionMapRef.current.set(sessionId, {
  messages,
  status: 'idle',
  error: null,
  pendingToolCalls: new Set(),
  pendingApprovals: new Map(),
});
```

- [ ] **Step 3: 在 chunk 处理中增加审批事件**

```typescript
case 'chunk': {
  // ... existing code
  const chunk = event.chunk;
  if (chunk.type === 'approval-request') {
    if (!state) {
      ensureSession(event.sessionId);
      state = map.get(event.sessionId);
      if (!state) return;
    }
    state.pendingApprovals.set(chunk.request.approvalId, chunk.request);
  } else if (chunk.type === 'approval-resolved') {
    if (!state) return;
    state.pendingApprovals.delete(chunk.approvalId);
  }
  // ... existing activity/status logic
  notifyChange();
}
```

- [ ] **Step 4: 暴露 `currentApproval` 和 `resolveApproval`**

```typescript
const currentApproval = useMemo(() => {
  if (!currentId) return undefined;
  const state = sessionMapRef.current.get(currentId);
  if (!state) return undefined;
  return state.pendingApprovals.values().next().value as ApprovalRequest | undefined;
}, [currentId, version]);

const resolveApproval = useCallback(
  async (approvalId: string, decision: ApprovalDecision) => {
    await agentService.resolveApproval(approvalId, decision);
  },
  [agentService],
);
```

- [ ] **Step 5: 恢复 pending approvals**

```typescript
async function loadPendingApprovals(sessionId: string) {
  try {
    const approvals = await agentService.listPendingApprovals(sessionId);
    const state = sessionMapRef.current.get(sessionId);
    if (!state) return;
    state.pendingApprovals = new Map(approvals.map((req) => [req.approvalId, req]));
    notifyChange();
  } catch {
    // ignore
  }
}
```

在 `ensureSession` 末尾、`onReconnect`、切换会话时调用。

- [ ] **Step 6: 加入返回对象**

```typescript
return {
  currentSession,
  sessions: sessionList,
  switchSession,
  createSession,
  deleteSession,
  send,
  interrupt,
  initialized,
  currentApproval,
  resolveApproval,
};
```

- [ ] **Step 7: 运行 Web 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 可能有 UI 集成未改导致的报错，先确认 hook 本身无错

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/use-agents.ts
```

---

### Task 17: `InputBox` 集成审批条

**Files:**
- Modify: `packages/web/src/components/chat/input-box.tsx`
- Modify: `packages/web/src/components/chat/chat-panel.tsx`

- [ ] **Step 1: `InputBox` 接收 pending approval**

```typescript
import { ApprovalBar } from './approval-bar';
import type { ApprovalRequest, ApprovalDecision } from 'rem-agent-bridge';

interface InputBoxProps {
  streaming: boolean;
  initialized: boolean;
  pendingApproval?: ApprovalRequest;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onSend(content: string): void;
  onInterrupt(): void;
}
```

- [ ] **Step 2: 渲染审批条并禁用输入**

```typescript
export function InputBox({ streaming, initialized, pendingApproval, onResolveApproval, onSend, onInterrupt }: InputBoxProps) {
  const hasApproval = !!pendingApproval;

  return (
    <div className="max-w-3xl mx-auto w-full">
      {hasApproval && pendingApproval && onResolveApproval && (
        <ApprovalBar
          request={pendingApproval}
          onResolve={(decision) => onResolveApproval(pendingApproval.approvalId, decision)}
        />
      )}
      <div className={cn('relative flex items-end gap-2 rounded-card border border-bd bg-card p-3', hasApproval && 'rounded-t-none border-t-0')}>
        <textarea
          disabled={streaming || !initialized || hasApproval}
          placeholder={hasApproval ? '等待审批...' : '输入消息...'}
          // ... existing textarea logic
        />
        {/* existing buttons */}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `ChatPanel` 传递 props**

```typescript
interface ChatPanelProps {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  initialized: boolean;
  pendingApproval?: ApprovalRequest;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onSend(content: string): void;
  onInterrupt(): void;
}

// 在 InputBox 处传入
<InputBox
  streaming={streaming}
  initialized={initialized}
  pendingApproval={pendingApproval}
  onResolveApproval={onResolveApproval}
  onSend={onSend}
  onInterrupt={onInterrupt}
/>
```

- [ ] **Step 4: page.tsx 连接**

```typescript
const { currentSession, currentApproval, resolveApproval, ... } = useAgents(agentService);

<ChatPanel
  messages={currentSession?.messages ?? []}
  status={currentSession?.status ?? 'idle'}
  error={currentSession?.error ?? null}
  activity={currentSession?.activity}
  initialized={initialized}
  pendingApproval={currentApproval}
  onResolveApproval={resolveApproval}
  onSend={send}
  onInterrupt={interrupt}
/>
```

- [ ] **Step 5: 运行 Web 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/chat packages/web/src/app/page.tsx
```

---

### Task 18: 移除服务端 `autoApproveDangerous: true`

**Files:**
- Modify: `packages/web/src/lib/container.ts`

- [ ] **Step 1: 修改 container.ts**

```typescript
const { pm } = await createAgentFromEnv({ sessionProvider });
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/container.ts
```

---

## Task 19: 全仓验证

- [ ] **Step 1: 全仓类型检查**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: 全仓测试**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 3: 最终提交**

```bash
git add -A
```

---

## Self-Review

- [ ] Spec coverage: 每个 design 章节都有对应任务。
- [ ] Placeholder scan: 无 TBD/TODO/"稍后实现"。
- [ ] Type consistency: `ApprovalRequest`、`ApprovalDecision`、`sessionId`、`emit` 命名全仓一致。
- [ ] Core 控制完整执行流程：工具校验 → 审批阻塞 → 执行/拒绝。
- [ ] Bridge 只实现 `AgentStateProvider` 和审批 API，不保存业务状态。
- [ ] Web 审批条位于 Chatbox 内部顶部。
- [ ] 服务端默认 `autoApproveDangerous: false`。
- [ ] `ApprovalOrchestrator` 内部保存 emitter，确保 `resolveApproval` 能发送 `approval-resolved` chunk。
