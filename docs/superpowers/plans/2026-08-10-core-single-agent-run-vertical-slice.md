# Core Single-Agent Run Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `rem-agent-core` 中建立以 Run 为中心、支持多 Context、SQLite 持久化、本地 Worker、REMAgent 执行、事件与 Artifact 输出的首个单 Agent 纵向切片。

**Architecture:** 新运行时在现有 AgentSystem 旁路建立，通过 `AgentRuntime` 公开稳定 API；领域类型位于 `domain/`，用例位于 `application/`，执行逻辑位于 `execution/`，外部能力接口位于 `sdk/`，SQLite 继续作为默认实现。旧 AgentSystem、Workspace、Team 和 Session 存储在本计划内暂时保留为内部兼容实现，新公开 API 不再依赖 Workspace；完成纵向切片后再用独立计划迁移和删除旧实现。

**Tech Stack:** TypeScript 5、Node.js 22、Vitest、better-sqlite3、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、TypeBox、pnpm。

---

## 范围边界

本计划交付：

- `AgentRuntime.as({ tenantId, principal })` 作用域 API；
- AgentDefinition 静态 Provider；
- Session 基础 Context 与 Run Context patch；
- Runtime Plugin 注册、Context 解析和确定性快照；
- message/task Run；
- SQLite Run、Event、WorkItem、Artifact、Idempotency 和 ToolInvocation；
- 本地 Worker 租约、取消、超时和重启恢复；
- REMAgent 单 Agent 执行适配器；
- 持久化 Event 查询与进程内 Signal 订阅；
- 端到端验收测试。

本计划不交付 Approval、Team、child Agent、A2A、Webhook、远程 Service/Client、PostgreSQL、分布式 Worker 和 Workbench 改造。现有 Workspace 专属实现不在本计划中删除；它不能出现在新 Runtime 公共输入和领域对象中。

## 文件结构锁定

新增文件及职责：

```text
packages/core/src/
  domain/
    agent-definition/types.ts       AgentDefinition 领域类型
    artifact/types.ts               Artifact 领域类型
    context/types.ts                ContextBinding、ContextPatch、快照类型
    context/apply-context-patch.ts  Context 合并纯函数
    event/types.ts                  RunEvent 与 RunSignal
    identity/types.ts               Principal 与可信请求上下文
    run/types.ts                    Run、触发器、WorkItem、ToolInvocation
    run/run-state.ts                Run 状态机纯函数
    session/types.ts                新 AgentSession 领域类型
  application/
    runtime/agent-runtime.ts        AgentRuntime 接口实现与 scoped facade
    runs/start-run.ts               startRun 用例
    runs/run-queries.ts             查询、取消、事件读取
    contexts/context-resolver.ts    ContextSet 解析与快照
  execution/
    run-executor.ts                 执行器稳定端口
    local-worker.ts                 本地租约 Worker
    rem-agent-executor.ts           REMAgent 单 Agent 适配器
    recording-tool-provider.ts      ToolInvocation 持久化包装器
  sdk/
    agent-definition-provider.ts    AgentDefinition Provider 接口
    runtime-plugin.ts               Runtime Plugin 明确贡献点
    runtime-storage.ts              新运行时事务与 Repository 接口
  plugin-system/
    runtime-plugin-host.ts          插件校验、注册与冲突检测
  plugins/
    agent-definition/static/        静态 AgentDefinition Provider
    storage/sqlite/
      runtime-ddl.ts                新运行时表定义
      runtime-row-mappers.ts        SQLite row 与领域对象转换
      runtime-store.ts              SQLite RuntimeStorage 实现
  runtime-events/
    run-signal-hub.ts               非持久化 Signal fan-out
  assembly/
    agent-runtime-assembly.ts       新 Runtime 装配入口

packages/core/tests/
  runtime-domain.test.ts
  runtime-plugin-host.test.ts
  runtime-storage-contract.test.ts
  sqlite-runtime-store.test.ts
  start-run.test.ts
  local-worker.test.ts
  rem-agent-executor.test.ts
  agent-runtime.test.ts
  runtime-recovery.test.ts
  helpers/fake-runtime-store.ts
```

每个实现文件保持在 200 行内，类型文件保持在 150 行内，聚合入口保持在 120 行内。不要在 `index.ts` 中放运行逻辑。

### Task 1: 建立新领域类型、Context patch 和 Run 状态机

**Files:**
- Create: `packages/core/src/domain/identity/types.ts`
- Create: `packages/core/src/domain/context/types.ts`
- Create: `packages/core/src/domain/context/apply-context-patch.ts`
- Create: `packages/core/src/domain/agent-definition/types.ts`
- Create: `packages/core/src/domain/session/types.ts`
- Create: `packages/core/src/domain/run/types.ts`
- Create: `packages/core/src/domain/run/run-state.ts`
- Create: `packages/core/src/domain/event/types.ts`
- Create: `packages/core/src/domain/artifact/types.ts`
- Test: `packages/core/tests/runtime-domain.test.ts`
- Modify: `packages/core/scripts/check-structure.mjs`

- [ ] **Step 1: 先写 Context 合并和状态机失败测试**

```typescript
import { describe, expect, it } from 'vitest';
import { applyContextPatch } from '../src/domain/context/apply-context-patch.js';
import { transitionRun } from '../src/domain/run/run-state.js';

describe('runtime domain', () => {
  it('按类型显式替换，并保留未替换类型的顺序', () => {
    const result = applyContextPatch(
      { bindings: [
        { type: 'acme/repository', contextId: 'rem' },
        { type: 'acme/customer', contextId: 'c-1' },
      ] },
      {
        replace: {
          'acme/repository': [{ type: 'acme/repository', contextId: 'sdk' }],
        },
        add: [{ type: 'acme/incident', contextId: 'inc-1' }],
      },
    );
    expect(result.bindings.map((item) => item.contextId)).toEqual(['c-1', 'sdk', 'inc-1']);
  });

  it('拒绝未声明的隐式重复绑定', () => {
    expect(() => applyContextPatch(
      { bindings: [{ type: 'acme/repository', contextId: 'rem' }] },
      { add: [{ type: 'acme/repository', contextId: 'rem' }] },
    )).toThrow('Duplicate context binding');
  });

  it('只允许合法 Run 状态迁移', () => {
    expect(transitionRun('queued', 'running')).toBe('running');
    expect(transitionRun('running', 'completed')).toBe('completed');
    expect(() => transitionRun('completed', 'running')).toThrow('Illegal run transition');
  });
});
```

- [ ] **Step 2: 运行测试确认缺少模块**

Run: `pnpm exec vitest run packages/core/tests/runtime-domain.test.ts`

Expected: FAIL，提示 `domain/context/apply-context-patch.js` 或 `domain/run/run-state.js` 不存在。

- [ ] **Step 3: 创建小型领域文件**

`domain/context/types.ts` 使用以下稳定形状：

```typescript
export interface ContextBinding {
  type: string;
  contextId: string;
  revision?: string;
  input?: unknown;
}

export interface ContextSet { bindings: ContextBinding[] }

export interface ContextPatch {
  replace?: Readonly<Record<string, readonly ContextBinding[]>>;
  add?: readonly ContextBinding[];
}

export interface ResolvedContextItem {
  binding: ContextBinding;
  pluginId: string;
  pluginVersion: string;
  snapshot: unknown;
  snapshotHash: string;
}

export interface ResolvedContextSnapshot {
  items: ResolvedContextItem[];
  configLayers: Array<{ name: string; priority: number; value: unknown }>;
  promptSections: Array<{ name: string; priority: number; content: string }>;
}
```

`domain/context/apply-context-patch.ts`：

```typescript
import type { ContextBinding, ContextPatch, ContextSet } from './types.js';

const keyOf = (binding: ContextBinding) => `${binding.type}\u0000${binding.contextId}`;

export function applyContextPatch(base: ContextSet, patch?: ContextPatch): ContextSet {
  if (!patch) return { bindings: base.bindings.slice() };
  const replaced = new Set(Object.keys(patch.replace ?? {}));
  const bindings = base.bindings.filter((binding) => !replaced.has(binding.type));
  for (const [type, values] of Object.entries(patch.replace ?? {})) {
    for (const value of values) {
      if (value.type !== type) throw new Error(`Context replacement type mismatch: ${type}`);
      bindings.push({ ...value });
    }
  }
  for (const value of patch.add ?? []) bindings.push({ ...value });
  const keys = new Set<string>();
  for (const binding of bindings) {
    const key = keyOf(binding);
    if (keys.has(key)) throw new Error(`Duplicate context binding: ${binding.type}/${binding.contextId}`);
    keys.add(key);
  }
  return { bindings };
}
```

`domain/run/run-state.ts`：

```typescript
import type { RunStatus } from './types.js';

const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'waiting'],
  waiting: ['queued', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function transitionRun(current: RunStatus, next: RunStatus): RunStatus {
  if (!transitions[current].includes(next)) {
    throw new Error(`Illegal run transition: ${current} -> ${next}`);
  }
  return next;
}

export const isTerminalRunStatus = (status: RunStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'cancelled';
```

其余类型文件使用以下完整定义，作为后续任务唯一命名来源。

`domain/identity/types.ts`：

```typescript
export interface Principal {
  principalId: string;
  roles: string[];
  claims?: Record<string, unknown>;
}

export interface RuntimeRequestContext {
  tenantId: string;
  principal: Principal;
}
```

`domain/agent-definition/types.ts`：

```typescript
export type RunTriggerType = 'message' | 'task';

export interface ContextTypeConstraint {
  type: string;
  min?: number;
  max?: number;
}

export interface AgentDefinition {
  agentId: string;
  revision: string;
  name: string;
  instructions: string;
  modelId: string;
  toolNames: readonly string[];
  acceptedTriggers: readonly RunTriggerType[];
  requiredContexts?: readonly ContextTypeConstraint[];
  optionalContexts?: readonly ContextTypeConstraint[];
  overridableContexts?: readonly string[];
  execution: { type: 'single-agent' };
}
```

`domain/session/types.ts`：

```typescript
import type { Message } from '@earendil-works/pi-ai';
import type { ContextSet } from '../context/types.js';

export interface AgentSession {
  sessionId: string;
  tenantId: string;
  contexts: ContextSet;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuntimeSessionEntry {
  entryId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  message: Message;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}
```

`domain/run/types.ts`：

```typescript
import type { Message } from '@earendil-works/pi-ai';
import type { ResolvedContextSnapshot } from '../context/types.js';

export type RunStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type RunTrigger =
  | { type: 'message'; content: Message['content'] }
  | { type: 'task'; input: unknown };

export interface AgentRun {
  runId: string;
  tenantId: string;
  principalId: string;
  sessionId: string;
  agentId: string;
  agentRevision: string;
  status: RunStatus;
  trigger: RunTrigger;
  contextSnapshot: ResolvedContextSnapshot;
  waitingReason?: 'recovery';
  errorCode?: string;
  cancellationRequestedAt?: Date;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  updatedAt: Date;
}

export interface WorkItem {
  workItemId: string;
  runId: string;
  status: 'queued' | 'leased' | 'completed' | 'failed';
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  attempt: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolInvocation {
  invocationId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  status: 'planned' | 'executing' | 'succeeded' | 'failed' | 'unknown';
  sideEffect: 'none' | 'idempotent' | 'non-idempotent';
  supportsIdempotencyKey: boolean;
  input: unknown;
  result?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

`domain/event/types.ts`：

```typescript
export interface RunEvent {
  eventId: string;
  sequence: number;
  schemaVersion: 1;
  tenantId: string;
  sessionId: string;
  runId: string;
  type: string;
  data: unknown;
  occurredAt: Date;
}

export interface RunSignal {
  runId: string;
  type: string;
  data?: unknown;
  occurredAt: Date;
}
```

`domain/artifact/types.ts`：

```typescript
export interface Artifact {
  artifactId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  type: string;
  mediaType: string;
  name: string;
  data?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type ArtifactDraft = Omit<Artifact, 'artifactId' | 'tenantId' | 'sessionId' | 'runId' | 'createdAt'>;
```

- [ ] **Step 4: 扩展结构检查的新顶层域**

把 `packages/core/scripts/check-structure.mjs` 的 `DOMAINS` 增加 `domain`、`application`、`execution`、`runtime-events`，并增加禁止边：`domain` 不得依赖其他 Core 顶层域，`sdk` 不得依赖 `application`、`execution`、`plugins` 和 `assembly`。领域文件可以依赖第三方纯类型。

- [ ] **Step 5: 运行领域测试和结构检查**

Run: `pnpm exec vitest run packages/core/tests/runtime-domain.test.ts && pnpm check:structure`

Expected: 两个命令均 PASS。

- [ ] **Step 6: 提交领域基础**

```bash
git add packages/core/src/domain packages/core/tests/runtime-domain.test.ts packages/core/scripts/check-structure.mjs
git commit -m "feat(core): add runtime domain model"
```

### Task 2: 建立 AgentDefinition Provider 和稳定错误模型

**Files:**
- Create: `packages/core/src/sdk/agent-definition-provider.ts`
- Create: `packages/core/src/plugins/agent-definition/static/provider.ts`
- Create: `packages/core/src/plugins/agent-definition/static/index.ts`
- Create: `packages/core/src/application/runtime/runtime-error.ts`
- Test: `packages/core/tests/agent-definition-provider.test.ts`
- Modify: `packages/core/src/sdk/index.ts`
- Modify: `packages/core/src/plugins/index.ts`

- [ ] **Step 1: 写 Provider revision 和重复定义测试**

```typescript
import { describe, expect, it } from 'vitest';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';

const definitions = [
  { agentId: 'support', revision: '1', name: 'Support', instructions: 'Help', modelId: 'default', toolNames: [], acceptedTriggers: ['message'] as const, execution: { type: 'single-agent' as const } },
  { agentId: 'support', revision: '2', name: 'Support', instructions: 'Help better', modelId: 'default', toolNames: [], acceptedTriggers: ['message'] as const, execution: { type: 'single-agent' as const } },
];

describe('StaticAgentDefinitionProvider', () => {
  it('默认返回最高 revision，显式 revision 返回固定版本', async () => {
    const provider = new StaticAgentDefinitionProvider(definitions);
    expect((await provider.get('support'))?.revision).toBe('2');
    expect((await provider.get('support', '1'))?.instructions).toBe('Help');
  });

  it('拒绝重复 agentId/revision', () => {
    expect(() => new StaticAgentDefinitionProvider([definitions[0], definitions[0]])).toThrow('Duplicate agent definition');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/agent-definition-provider.test.ts`

Expected: FAIL，Provider 模块不存在。

- [ ] **Step 3: 实现接口、静态 Provider 和 RuntimeError**

```typescript
export interface AgentDefinitionProvider {
  init(): Promise<void>;
  get(agentId: string, revision?: string): Promise<AgentDefinition | null>;
  list(): Promise<AgentDefinition[]>;
}
```

静态 Provider 在构造时建立 `agentId -> revision -> definition` Map；`get(agentId)` 按 `revision.localeCompare(..., undefined, { numeric: true })` 选择最高版本，并返回浅复制对象。`init()` 为幂等空操作。

`RuntimeError` 使用以下签名：

```typescript
export type RuntimeErrorCode =
  | 'INVALID_INPUT' | 'UNAUTHENTICATED' | 'FORBIDDEN'
  | 'AGENT_NOT_FOUND' | 'AGENT_REVISION_NOT_FOUND' | 'TRIGGER_NOT_SUPPORTED'
  | 'SESSION_NOT_FOUND' | 'RUN_NOT_FOUND' | 'RUN_CONFLICT' | 'RUN_ALREADY_TERMINAL'
  | 'CONTEXT_TYPE_NOT_FOUND' | 'CONTEXT_INVALID' | 'CONTEXT_CONFLICT' | 'CONTEXT_UNAUTHORIZED'
  | 'PLUGIN_DEPENDENCY_MISSING' | 'TOOL_NOT_FOUND' | 'TOOL_DENIED'
  | 'TOOL_EXECUTION_FAILED' | 'TOOL_RESULT_UNKNOWN' | 'MODEL_UNAVAILABLE'
  | 'MODEL_EXECUTION_FAILED' | 'STORAGE_CONFLICT' | 'STORAGE_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT' | 'EXECUTION_TIMEOUT' | 'EXECUTION_CANCELLED' | 'INTERNAL_ERROR';

export class RuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) { super(message, options); this.name = 'RuntimeError'; }
}
```

- [ ] **Step 4: 导出并验证**

Run: `pnpm exec vitest run packages/core/tests/agent-definition-provider.test.ts && pnpm --filter rem-agent-core typecheck`

Expected: PASS。

- [ ] **Step 5: 提交 Provider**

```bash
git add packages/core/src/sdk packages/core/src/plugins/agent-definition packages/core/src/application/runtime/runtime-error.ts packages/core/tests/agent-definition-provider.test.ts packages/core/src/plugins/index.ts
git commit -m "feat(core): add agent definition provider"
```

### Task 3: 建立 Runtime Plugin Host 和 Context 解析器

**Files:**
- Create: `packages/core/src/sdk/runtime-plugin.ts`
- Create: `packages/core/src/plugin-system/runtime-plugin-host.ts`
- Create: `packages/core/src/application/contexts/context-resolver.ts`
- Test: `packages/core/tests/runtime-plugin-host.test.ts`

- [ ] **Step 1: 写多 Context、冲突和快照确定性测试**

测试注册两个插件：`acme/repository-plugin@1.0.0` 解析 `acme/repository`，`acme/customer-plugin@2.0.0` 解析 `acme/customer`。断言：

```typescript
expect(snapshot.items.map((item) => item.pluginId)).toEqual([
  'acme/repository-plugin',
  'acme/customer-plugin',
]);
expect(snapshot.promptSections.map((item) => item.name)).toEqual([
  'acme/repository-plugin:repository',
  'acme/customer-plugin:customer',
]);
expect(() => host.register(duplicateContextPlugin)).toThrow('Context type already registered');
```

再传入拒绝当前 Principal 的 resolver，断言抛出 `RuntimeError` 且 code 为 `CONTEXT_UNAUTHORIZED`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/runtime-plugin-host.test.ts`

Expected: FAIL，RuntimePluginHost 不存在。

- [ ] **Step 3: 实现明确贡献点**

`sdk/runtime-plugin.ts` 定义：

```typescript
import type { TObject } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor } from './tool-provider.js';

export interface RuntimeToolContribution<T extends TObject = TObject> {
  definition: ToolDefinition<T>;
  executor: ToolExecutor<T>;
}

export interface ContextResolutionInput {
  binding: ContextBinding;
  request: RuntimeRequestContext;
}

export interface ContextResolution {
  snapshot: unknown;
}

export interface ContextRuntimeContributions {
  configLayers?: Array<{ name: string; priority: number; value: unknown }>;
  promptSections?: Array<{ name: string; priority: number; content: string }>;
  tools?: RuntimeToolContribution[];
}

export interface ContextTypeContribution {
  type: string;
  resolve(input: ContextResolutionInput): Promise<ContextResolution>;
  materialize(snapshot: unknown): Promise<ContextRuntimeContributions>;
}

export interface RuntimePluginRegistrar {
  addContextType(contribution: ContextTypeContribution): void;
}

export interface RuntimePlugin {
  manifest: { pluginId: string; version: string; dependencies?: string[] };
  register(registrar: RuntimePluginRegistrar): void;
}
```

Host 先校验全部 manifest ID、版本、依赖和重复 Context 类型，再一次性提交注册结果；失败时不能留下半注册状态。ContextResolver 按 ContextSet 顺序执行 `resolve()` 完成授权和快照，再执行 `materialize()` 收集运行贡献；给配置和 Prompt 名称加 plugin ID 前缀，分别按 `priority` 稳定排序，使用 `node:crypto` 的 SHA-256 对 canonical JSON 生成 `snapshotHash`。对象 key 递归排序后再序列化，确保同样输入得到同样哈希。

Host 还提供 `materializeSnapshot(snapshot)`：根据每个 item 中固化的 pluginId/pluginVersion 找到完全匹配的插件，再用持久化 snapshot 重建工具贡献；版本不匹配时抛 `PLUGIN_DEPENDENCY_MISSING`。这样 Worker 重启后不需要重新执行授权解析，也不需要持久化 Principal claims 或工具函数。

- [ ] **Step 4: 运行测试**

Run: `pnpm exec vitest run packages/core/tests/runtime-plugin-host.test.ts && pnpm check:structure`

Expected: PASS。

- [ ] **Step 5: 提交 Plugin Host**

```bash
git add packages/core/src/sdk/runtime-plugin.ts packages/core/src/plugin-system/runtime-plugin-host.ts packages/core/src/application/contexts packages/core/tests/runtime-plugin-host.test.ts
git commit -m "feat(core): add runtime context plugins"
```

### Task 4: 定义 RuntimeStorage 事务契约和共享契约测试

**Files:**
- Create: `packages/core/src/sdk/runtime-storage.ts`
- Create: `packages/core/tests/helpers/fake-runtime-store.ts`
- Create: `packages/core/tests/runtime-storage-contract.ts`
- Create: `packages/core/tests/runtime-storage-contract.test.ts`
- Modify: `packages/core/src/sdk/index.ts`

- [ ] **Step 1: 写可复用存储契约**

契约工厂接收 `createStore(): Promise<{ store: RuntimeStorage; close(): Promise<void> }>`，至少覆盖：

```typescript
export function runtimeStorageContract(createStore: RuntimeStoreFactory): void {
  it('原子创建 session、run、初始事件、work item 和幂等记录', async () => { /* 使用固定输入并逐项断言 */ });
  it('相同幂等键和 requestHash 返回同一 run', async () => { /* 断言 resourceId 相同 */ });
  it('相同幂等键和不同 requestHash 报冲突', async () => { /* 断言 IDEMPOTENCY_CONFLICT */ });
  it('只有一个 owner 能领取同一个 work item', async () => { /* 并发 claim 后只有一个非 null */ });
  it('租约过期后可被另一 owner 领取', async () => { /* 使用可注入 clock */ });
  it('事件 sequence 单调且 cursor 为 exclusive', async () => { /* 断言 [2, 3] */ });
  it('run 状态与对应事件在一个事务提交', async () => { /* 主动抛错后断言均未改变 */ });
}
```

- [ ] **Step 2: 运行测试确认缺少契约**

Run: `pnpm exec vitest run packages/core/tests/runtime-storage-contract.test.ts`

Expected: FAIL，RuntimeStorage 或 FakeRuntimeStore 不存在。

- [ ] **Step 3: 定义同步事务内的 Unit of Work**

```typescript
export interface RuntimeSessionRepository {
  insert(session: AgentSession): void;
  get(sessionId: string): AgentSession | null;
  appendEntries(entries: RuntimeSessionEntry[]): void;
  listEntries(sessionId: string): RuntimeSessionEntry[];
}

export interface RuntimeRunRepository {
  insert(run: AgentRun): void;
  get(runId: string): AgentRun | null;
  update(run: AgentRun): void;
}

export interface RuntimeEventRepository {
  append(event: RunEvent): void;
  nextSequence(runId: string): number;
  list(runId: string, afterSequence: number, limit: number): RunEvent[];
}

export interface RuntimeWorkItemRepository {
  insert(item: WorkItem): void;
  getByRun(runId: string): WorkItem | null;
  update(item: WorkItem): void;
}

export interface RuntimeArtifactRepository {
  insert(artifact: Artifact): void;
  listByRun(runId: string): Artifact[];
}

export interface IdempotencyRecord {
  tenantId: string;
  operation: 'start-run';
  idempotencyKey: string;
  requestHash: string;
  resourceId: string;
  createdAt: Date;
}

export interface RuntimeIdempotencyRepository {
  get(tenantId: string, operation: 'start-run', key: string): IdempotencyRecord | null;
  insert(record: IdempotencyRecord): void;
}

export interface RuntimeToolInvocationRepository {
  insert(invocation: ToolInvocation): void;
  get(invocationId: string): ToolInvocation | null;
  update(invocation: ToolInvocation): void;
  listByRun(runId: string): ToolInvocation[];
}

export interface RuntimeUnitOfWork {
  sessions: RuntimeSessionRepository;
  runs: RuntimeRunRepository;
  events: RuntimeEventRepository;
  workItems: RuntimeWorkItemRepository;
  artifacts: RuntimeArtifactRepository;
  idempotency: RuntimeIdempotencyRepository;
  toolInvocations: RuntimeToolInvocationRepository;
}

export type RuntimeTransactionCallback = (uow: RuntimeUnitOfWork) => unknown;
export type SynchronousRuntimeTransactionCallback<T extends RuntimeTransactionCallback> =
  T & (Extract<ReturnType<T>, PromiseLike<unknown>> extends never ? unknown : never);

export interface RuntimeStorage {
  transaction<T extends RuntimeTransactionCallback>(
    operation: SynchronousRuntimeTransactionCallback<T>,
  ): Promise<ReturnType<T>>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  getRun(runId: string): Promise<AgentRun | null>;
  listEvents(runId: string, afterSequence?: number, limit?: number): Promise<RunEvent[]>;
  listArtifacts(runId: string): Promise<Artifact[]>;
  claimWorkItem(owner: string, now: Date, leaseMs: number): Promise<WorkItem | null>;
  listRecoverableWorkItems(now: Date): Promise<WorkItem[]>;
}
```

Repository 的写方法保持同步，禁止在 SQLite transaction callback 内执行 Promise。FakeRuntimeStore 对每次 transaction 先深复制状态，callback 抛错时丢弃副本，成功时替换正式状态。

- [ ] **Step 4: 完成 Fake 并运行契约**

Run: `pnpm exec vitest run packages/core/tests/runtime-storage-contract.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交存储契约**

```bash
git add packages/core/src/sdk/runtime-storage.ts packages/core/src/sdk/index.ts packages/core/tests/helpers/fake-runtime-store.ts packages/core/tests/runtime-storage-contract.ts packages/core/tests/runtime-storage-contract.test.ts
git commit -m "feat(core): define runtime storage contract"
```

### Task 5: 实现 SQLite RuntimeStorage

**Files:**
- Create: `packages/core/src/plugins/storage/sqlite/runtime-ddl.ts`
- Create: `packages/core/src/plugins/storage/sqlite/runtime-row-mappers.ts`
- Create: `packages/core/src/plugins/storage/sqlite/runtime-store.ts`
- Test: `packages/core/tests/sqlite-runtime-store.test.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/schema.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/provider.ts`
- Modify: `packages/core/src/sdk/storage-provider.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/index.ts`

- [ ] **Step 1: 对 SQLite 实现运行同一契约**

```typescript
import Database from 'better-sqlite3';
import { runtimeStorageContract } from './runtime-storage-contract.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';

runtimeStorageContract(async () => {
  const db = new Database(':memory:');
  new SqliteSchemaManager(db).migrate();
  return { store: new SqliteRuntimeStore(db), close: async () => db.close() };
});
```

除复用上述单 Store 契约外，新增跨连接竞争测试：对同一个临时 SQLite 文件分别打开两个独立 `Database` / `SqliteRuntimeStore`，用可控 barrier、`BEGIN IMMEDIATE` 或等价同步方式让两个 `claimWorkItem()` 竞争同一记录，断言恰好一个领取成功。单连接 `Promise.all` 只覆盖内存 Fake 的接口级串行化，不能替代此 SQLite 跨连接测试。

`SqliteRuntimeStore.transaction` 的 concrete 方法签名必须直接复用 `SynchronousRuntimeTransactionCallback`，不能因实现类单独写成接受宽泛回调的签名而绕过 SDK 的同步事务约束。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/sqlite-runtime-store.test.ts`

Expected: FAIL，SQLite RuntimeStore 不存在。

- [ ] **Step 3: 增加 v12 运行时表**

`runtime-ddl.ts` 创建：

```typescript
export const RUNTIME_DDL = `
  CREATE TABLE IF NOT EXISTS runtime_sessions (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, contexts_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runtime_sessions_tenant_updated
    ON runtime_sessions(tenant_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS runtime_runs (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, principal_id TEXT NOT NULL,
    session_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_revision TEXT NOT NULL,
    status TEXT NOT NULL, trigger_json TEXT NOT NULL, context_snapshot_json TEXT NOT NULL,
    waiting_reason TEXT, error_code TEXT, cancellation_requested_at TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_runtime_runs_session_created
    ON runtime_runs(session_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS runtime_events (
    id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, schema_version INTEGER NOT NULL,
    tenant_id TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT NOT NULL,
    type TEXT NOT NULL, data_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
    UNIQUE(run_id, sequence),
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS runtime_work_items (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
    lease_owner TEXT, lease_expires_at TEXT, attempt INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_runtime_work_claim
    ON runtime_work_items(status, lease_expires_at, created_at);

  CREATE TABLE IF NOT EXISTS runtime_session_entries (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_id TEXT NOT NULL,
    run_id TEXT NOT NULL, sequence INTEGER NOT NULL, message_json TEXT NOT NULL,
    metadata_json TEXT, created_at TEXT NOT NULL, UNIQUE(session_id, sequence),
    FOREIGN KEY (session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS runtime_artifacts (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_id TEXT NOT NULL,
    run_id TEXT NOT NULL, type TEXT NOT NULL, media_type TEXT NOT NULL,
    name TEXT NOT NULL, data TEXT, uri TEXT, metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS runtime_idempotency (
    tenant_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL, resource_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, operation, idempotency_key)
  );

  CREATE TABLE IF NOT EXISTS runtime_tool_invocations (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, session_id TEXT NOT NULL,
    run_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL,
    status TEXT NOT NULL, side_effect TEXT NOT NULL,
    supports_idempotency_key INTEGER NOT NULL, input_json TEXT NOT NULL,
    result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(run_id, tool_call_id),
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );
`;
```

所有 JSON 列以 `_json` 结尾；时间统一 ISO 8601 TEXT；`runtime_events` 使用 `(run_id, sequence)` unique；幂等表使用 `(tenant_id, operation, idempotency_key)` primary key；WorkItem 为 `status/lease_owner/lease_expires_at/attempt` 建索引。新表使用 `runtime_` 前缀，避免在迁移期与旧 sessions/session_entries 产生语义冲突。

把 `CURRENT_SCHEMA_VERSION` 增加到 12。新安装执行全部 DDL；v11 升级只创建新表，不重写旧开发数据。

- [ ] **Step 4: 实现 Mapper 和 Store**

Mapper 独立负责 Date/JSON 转换。Store 的 `transaction()` 使用 `db.transaction(operation)`，通过一个私有 `createUnitOfWork()` 返回绑定同一 Database 的 Repository。`claimWorkItem()` 在单个 SQLite transaction 内先选择 `queued` 或过期 `leased` 记录，再条件更新 owner、expiry、attempt，更新行数不是 1 时返回 null。

在现有 `StorageProvider` 增加只读 `runtimeStore: RuntimeStorage`；SqliteStorageProvider 在 `open()` 初始化，在 `close()` 清空引用。不要删除旧 workspaceStore。

- [ ] **Step 5: 运行 SQLite 契约和旧存储测试**

Run: `pnpm exec vitest run packages/core/tests/sqlite-runtime-store.test.ts packages/core/tests/sqlite-storage.test.ts packages/core/tests/sqlite-migrations-coverage.test.ts`

Expected: PASS，schema version 断言更新为 12。

- [ ] **Step 6: 提交 SQLite 实现**

```bash
git add packages/core/src/plugins/storage/sqlite packages/core/src/sdk/storage-provider.ts packages/core/tests/sqlite-runtime-store.test.ts packages/core/tests/sqlite-storage.test.ts
git commit -m "feat(core): persist runtime runs in sqlite"
```

### Task 6: 实现 startRun 用例、Context 约束和幂等创建

**Files:**
- Create: `packages/core/src/application/runs/start-run.ts`
- Create: `packages/core/src/application/runs/start-run-hash.ts`
- Test: `packages/core/tests/start-run.test.ts`

- [ ] **Step 1: 写 startRun 行为测试**

覆盖五个场景：自动创建 Session；使用已有同 tenant Session；拒绝跨 tenant Session；拒绝 Agent 不支持的 trigger；同一 idempotency key 返回同一 Run；相同 key 不同输入返回 `IDEMPOTENCY_CONFLICT`。

关键断言：

```typescript
const run = await usecase.execute(requestContext, {
  agentId: 'support',
  trigger: { type: 'task', input: { ticketId: 't-1' } },
  contexts: { add: [{ type: 'acme/customer', contextId: 'c-1' }] },
  idempotencyKey: 'ticket-t-1',
});
expect(run.status).toBe('queued');
expect((await store.listEvents(run.runId)).map((event) => event.type)).toEqual(['run.created']);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/start-run.test.ts`

Expected: FAIL，StartRunUsecase 不存在。

- [ ] **Step 3: 实现确定性请求哈希**

`start-run-hash.ts` 对 `tenantId/agentId/revision/sessionId/trigger/context patch` 做 canonical JSON + SHA-256。Principal 的 claims 和 roles 不进入哈希，principalId 进入哈希。

- [ ] **Step 4: 实现 startRun 事务**

执行顺序固定为：加载 Definition；校验 trigger；加载或创建 Session；验证 tenant；应用 ContextPatch；校验 required/optional/overridable context；解析 ContextSnapshot；计算 requestHash；在一个 RuntimeStorage transaction 内检查幂等记录并创建 Session、Run、`run.created` Event、queued WorkItem 和幂等记录。

同键同哈希返回已有 Run；同键不同哈希抛 `RuntimeError('IDEMPOTENCY_CONFLICT', ...)`。Run 保存 agentId 和 revision 快照，不保存 Secret。

- [ ] **Step 5: 运行测试**

Run: `pnpm exec vitest run packages/core/tests/start-run.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交 startRun**

```bash
git add packages/core/src/application/runs packages/core/tests/start-run.test.ts
git commit -m "feat(core): create idempotent agent runs"
```

### Task 7: 实现本地 Worker、租约、取消和超时

**Files:**
- Create: `packages/core/src/execution/run-executor.ts`
- Create: `packages/core/src/execution/local-worker.ts`
- Create: `packages/core/src/execution/run-completion.ts`
- Test: `packages/core/tests/local-worker.test.ts`

- [ ] **Step 1: 写 Worker 测试**

使用可控的 FakeRuntimeStore、FakeClock 和 FakeExecutor，覆盖：领取 queued Run 并完成；executor 抛错后写 `run.failed`；Abort 后写 `run.cancelled`；超过 timeout 后写 `EXECUTION_TIMEOUT`；两个 Worker 竞争只执行一次；过期租约由新 Worker 恢复。

```typescript
export interface RunExecutor {
  execute(input: {
    run: AgentRun;
    session: AgentSession;
    signal: AbortSignal;
  }): Promise<RunExecutionResult>;
}

export interface RunExecutionResult {
  sessionEntries: Array<{ message: Message; metadata?: Record<string, unknown> }>;
  artifacts: ArtifactDraft[];
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/local-worker.test.ts`

Expected: FAIL，LocalRunWorker 不存在。

- [ ] **Step 3: 实现单次 drain Worker**

LocalRunWorker 首先提供确定性的 `drainOne(): Promise<boolean>`：claim WorkItem；事务内把 Run 变为 running 并写 `run.started`；创建 AbortController 和 timeout timer；调用 executor；成功时同一事务追加 SessionEntry/Artifact、完成 Run/WorkItem 并写 `artifact.created` 与 `run.completed`；失败、取消和超时分别写稳定 error code 与终态事件。`start()` 仅用短 interval 重复 drain，`stop()` 清理 timer 并等待当前 drain 完成。

Worker 保存 `runId -> AbortController` Map，`cancel(runId)` 先在事务内标记取消请求；活动 Run 立即 abort，queued Run 直接进入 cancelled 终态。

- [ ] **Step 4: 运行 Worker 测试**

Run: `pnpm exec vitest run packages/core/tests/local-worker.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交 Worker**

```bash
git add packages/core/src/execution packages/core/tests/local-worker.test.ts
git commit -m "feat(core): execute runs with leased local worker"
```

### Task 8: 适配 REMAgent，并记录 ToolInvocation

**Files:**
- Create: `packages/core/src/execution/rem-agent-executor.ts`
- Create: `packages/core/src/execution/recording-tool-provider.ts`
- Test: `packages/core/tests/rem-agent-executor.test.ts`
- Modify: `packages/core/src/sdk/tool-provider.ts`

- [ ] **Step 1: 写真实 REMAgent 适配测试**

使用 `createScriptedModels` 返回一次 assistant message，并注册一个 Context Plugin 工具 `acme_lookup_customer`。脚本模型先发起工具调用，再基于工具结果返回最终文本。断言：

- executor 读取此前 runtime_session_entries 作为 transcript；
- Context prompt section 出现在模型 system prompt；
- 工具成功后 ToolInvocation 为 `succeeded`；
- 返回的 SessionEntry 包含 user 和 assistant message；
- 最终生成 `text/plain` result Artifact。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/rem-agent-executor.test.ts`

Expected: FAIL，REMAgentRunExecutor 不存在。

- [ ] **Step 3: 扩展工具执行上下文和副作用声明**

向 `ToolDefinition` 增加：

```typescript
sideEffect?: 'none' | 'idempotent' | 'non-idempotent';
supportsIdempotencyKey?: boolean;
```

向 `ToolContext` 增加可选 `tenantId`、`principalId`、`runId`、`invocationId` 和 `idempotencyKey`。保持字段可选，使旧工具继续构建；新 Runtime 创建的工具调用必须全部提供。

- [ ] **Step 4: 实现 RecordingToolProvider**

包装每次 Run 的有效 ToolProvider。执行前事务内写 `planned` 后立即变为 `executing`，并追加 `tool.started`；成功写 `succeeded`、result 和 `tool.succeeded`；明确异常写 `failed` 和 `tool.failed`。每次状态与对应 Event 使用同一个 RuntimeStorage transaction，并通过 Event Repository 的 `nextSequence()` 分配序号。调用现有 provider 时传入 run/tenant/principal/idempotency 上下文。禁止执行 AgentDefinition 未列入 `toolNames` 的工具，并抛 `TOOL_DENIED`。

- [ ] **Step 5: 实现 REMAgentRunExecutor**

适配器接收 `AgentAssembly`、DefinitionProvider、RuntimeStorage 和 RuntimePluginHost。它把新 SessionEntry 投影为旧 `Session.conversation`，为本次 Run 克隆 AgentDI 并替换成 RecordingToolProvider，按 priority 组装 Context prompt sections，再构造 REMAgent。过渡期传给旧 REMAgent 的 `workspace/workspaceRoot` 使用插件快照中显式的 `executionRoot`；没有 executionRoot 时使用 `process.cwd()`，但该值不得进入新领域对象或公共 API。禁用 delegation、todo 和 orchestration capabilities。

消费 REMAgentEvent：`message-persist` 收集为新 SessionEntry；`finish` 返回文本 Artifact；`error` 映射为 `MODEL_EXECUTION_FAILED`；Abort 映射为 `EXECUTION_CANCELLED`。适配器不直接修改 Run 状态，由 Worker 统一提交终态。

- [ ] **Step 6: 运行适配器与旧 Agent 测试**

Run: `pnpm exec vitest run packages/core/tests/rem-agent-executor.test.ts packages/core/tests/rem-agent.test.ts packages/core/tests/agent-system.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交执行适配器**

```bash
git add packages/core/src/execution packages/core/src/sdk/tool-provider.ts packages/core/tests/rem-agent-executor.test.ts
git commit -m "feat(core): execute runtime runs with rem agent"
```

### Task 9: 建立 AgentRuntime facade、查询、事件订阅与生命周期

**Files:**
- Create: `packages/core/src/application/runtime/types.ts`
- Create: `packages/core/src/application/runtime/agent-runtime.ts`
- Create: `packages/core/src/application/runs/run-queries.ts`
- Create: `packages/core/src/runtime-events/run-signal-hub.ts`
- Test: `packages/core/tests/agent-runtime.test.ts`

- [ ] **Step 1: 写公共 facade 测试**

覆盖：未 initialize 时拒绝调用；`as()` 不允许空 tenant/principal；start 返回 queued Run；get 进行 tenant 隔离；listEvents 使用 exclusive cursor；subscribe 收到 `run.started` 与终态 Signal；cancel queued/running Run；shutdown 后 Worker 停止且 Storage 不再执行新任务。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/agent-runtime.test.ts`

Expected: FAIL，AgentRuntimeImpl 不存在。

- [ ] **Step 3: 实现 facade 接口**

```typescript
export interface AgentRuntime {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  as(context: RuntimeRequestContext): ScopedAgentRuntime;
}

export interface ScopedAgentRuntime {
  agents: {
    list(): Promise<AgentDefinition[]>;
    get(agentId: string, revision?: string): Promise<AgentDefinition>;
  };
  sessions: {
    get(sessionId: string): Promise<AgentSession>;
  };
  runs: {
    start(input: StartRunInput): Promise<AgentRun>;
    get(runId: string): Promise<AgentRun>;
    cancel(runId: string): Promise<AgentRun>;
    listEvents(runId: string, afterSequence?: number, limit?: number): Promise<RunEvent[]>;
    subscribe(runId: string, signal?: AbortSignal): AsyncIterable<RunSignal>;
    waitForCompletion(runId: string, signal?: AbortSignal): Promise<AgentRun>;
  };
  artifacts: {
    listByRun(runId: string): Promise<Artifact[]>;
  };
}
```

所有查询先加载资源再校验 tenant；不存在和跨 tenant 都对外返回 `RUN_NOT_FOUND` 或 `SESSION_NOT_FOUND`，避免泄露资源存在性。

- [ ] **Step 4: 实现 SignalHub**

SignalHub 只做进程内 fan-out，订阅创建前先由 facade 读取持久化 Run 状态；若 Run 已终态立即结束。Signal 丢失不影响正确性，`waitForCompletion` 每次收到 Signal 后重新读取 Run，并以短轮询作为兜底。

- [ ] **Step 5: 运行 facade 测试**

Run: `pnpm exec vitest run packages/core/tests/agent-runtime.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交 Runtime facade**

```bash
git add packages/core/src/application/runtime packages/core/src/application/runs/run-queries.ts packages/core/src/runtime-events packages/core/tests/agent-runtime.test.ts
git commit -m "feat(core): expose scoped agent runtime"
```

### Task 10: 增加新装配入口和收窄稳定公开 API

**Files:**
- Create: `packages/core/src/assembly/agent-runtime-assembly.ts`
- Create: `packages/core/src/application/runtime/index.ts`
- Test: `packages/core/tests/agent-runtime-assembly.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/helpers/fake-di.ts`

- [ ] **Step 1: 写默认装配测试**

断言 `createAgentRuntime()` 可以注入 storage、models、AgentDefinitionProvider 和 plugins；`createAgentRuntimeFromEnv()` 使用默认 SQLite/模型配置但仍要求显式 AgentDefinitionProvider；initialize/shutdown 均幂等。测试不得读取真实模型密钥或发出网络请求。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/agent-runtime-assembly.test.ts`

Expected: FAIL，新装配入口不存在。

- [ ] **Step 3: 实现装配入口**

```typescript
export interface CreateAgentRuntimeOptions {
  agentDefinitions: AgentDefinitionProvider;
  plugins?: readonly RuntimePlugin[];
  storage?: StorageProvider;
  assembly?: AgentAssembly;
  worker?: { owner?: string; leaseMs?: number; pollMs?: number; runTimeoutMs?: number };
}

export function createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime;
export async function createAgentRuntimeFromEnv(options: CreateAgentRuntimeOptions): Promise<AgentRuntime>;
```

`createAgentRuntime` 只同步装配；调用方显式执行 `initialize()`。`createAgentRuntimeFromEnv` 完成旧 AgentAssembly 初始化和新 Runtime 初始化。Runtime shutdown 关闭 Worker，但由它创建的默认 Storage 才由它关闭；注入 Storage 的生命周期仍归调用方。

- [ ] **Step 4: 重写稳定导出区**

在 `packages/core/src/index.ts` 顶部导出新 Runtime、领域类型、AgentDefinitionProvider、RuntimePlugin、RuntimeStorage 和 RuntimeError，并使用以下公共别名：

```typescript
export type { AgentSession as Session } from './domain/session/types.js';
export type { AgentRun as Run } from './domain/run/types.js';
```

删除当前 `export * from './session/model.js'`，避免两个 Session 冲突；旧实现需要的测试类型改为从 `../src/session/model.js` 直接导入。其余旧导出移动到清晰标记的 `Legacy internal compatibility exports` 区域；本计划暂不物理删除，以免 Team 等旧代码同时失效。不要再把 ApprovalEngine 描述为稳定高级 API。

- [ ] **Step 5: 运行装配、类型和结构检查**

Run: `pnpm exec vitest run packages/core/tests/agent-runtime-assembly.test.ts && pnpm --filter rem-agent-core typecheck && pnpm check:structure`

Expected: PASS。

- [ ] **Step 6: 提交装配入口**

```bash
git add packages/core/src/assembly/agent-runtime-assembly.ts packages/core/src/application/runtime/index.ts packages/core/src/index.ts packages/core/tests/agent-runtime-assembly.test.ts packages/core/tests/helpers/fake-di.ts
git commit -m "feat(core): add agent runtime assembly"
```

### Task 11: 实现重启恢复和 ToolInvocation 不确定状态

**Files:**
- Create: `packages/core/src/execution/recover-runtime.ts`
- Test: `packages/core/tests/runtime-recovery.test.ts`
- Modify: `packages/core/src/execution/local-worker.ts`
- Modify: `packages/core/src/application/runtime/agent-runtime.ts`

- [ ] **Step 1: 写真实 SQLite 重启测试**

使用临时数据库文件构造第一个 Runtime，在以下位置模拟终止：Run queued；WorkItem leased 但未开始；Run running 且没有 executing ToolInvocation；Run running 且存在 non-idempotent executing ToolInvocation。关闭第一个数据库连接，再创建第二个 Runtime。

断言前三种恢复为 queued 并最终完成；最后一种 ToolInvocation 变为 `unknown`，Run 变为 `waiting`、`waitingReason: 'recovery'`，事件包含 `tool.result_unknown` 和 `run.waiting`，不会再次调用工具。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/core/tests/runtime-recovery.test.ts`

Expected: FAIL，恢复逻辑尚未执行。

- [ ] **Step 3: 实现 initialize 恢复审计**

Runtime initialize 在 Worker start 前运行恢复事务：

- 过期 leased WorkItem 重新 queued；
- running Run 没有 executing ToolInvocation 时重新 queued 并写 `run.requeued`；
- executing ToolInvocation 的 definition 为 `none`、`idempotent` 或支持 idempotency key 时标记该 invocation 可重试并重新 queued；
- non-idempotent 且无法 reconcile 时标记 unknown，把 Run 转为 waiting 并写两个事件。

每次恢复使用 Event Repository 提供的 next sequence，状态与事件同事务提交。

- [ ] **Step 4: 运行恢复和存储契约测试**

Run: `pnpm exec vitest run packages/core/tests/runtime-recovery.test.ts packages/core/tests/sqlite-runtime-store.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交恢复逻辑**

```bash
git add packages/core/src/execution/recover-runtime.ts packages/core/src/execution/local-worker.ts packages/core/src/application/runtime/agent-runtime.ts packages/core/tests/runtime-recovery.test.ts
git commit -m "feat(core): recover interrupted agent runs"
```

### Task 12: 完成端到端验收、结构检查和架构文档同步

**Files:**
- Create: `packages/core/tests/agent-runtime-acceptance.test.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/module-reference.md`
- Modify: `packages/core/README.md`（如果文件不存在则 Create）

- [ ] **Step 1: 写首个里程碑验收测试**

测试场景固定为：静态 `ticket-worker@1` AgentDefinition；Session 绑定 customer Context；Run patch 增加 repository Context；两个插件分别贡献 Prompt 和 `acme_get_ticket` 工具；脚本模型调用工具并返回结构化结论；Runtime 使用临时 SQLite；等待完成后重新打开 Runtime 查询同一 Run。

最终断言：

```typescript
expect(run.status).toBe('completed');
expect(events.map((event) => event.type)).toEqual([
  'run.created', 'run.started', 'tool.started', 'tool.succeeded',
  'artifact.created', 'run.completed',
]);
expect(artifacts[0]).toMatchObject({ type: 'result', mediaType: 'text/plain' });
expect(reopenedRun.contextSnapshot.items.map((item) => item.binding.type)).toEqual([
  'acme/customer', 'acme/repository',
]);
```

- [ ] **Step 2: 运行验收测试并修复真实集成缺口**

Run: `pnpm exec vitest run packages/core/tests/agent-runtime-acceptance.test.ts`

Expected: PASS。只修复验收测试揭示的接口接线问题，不在此步骤增加新领域能力。

- [ ] **Step 3: 更新文档**

`docs/architecture.md` 增加新 Runtime 请求路径、事务边界和旧 AgentSystem 过渡说明；`docs/module-reference.md` 逐项说明新目录；Core README 给出不依赖 Workspace 的最小示例：创建静态 Definition、注册 Context Plugin、装配、`runtime.as(...).runs.start(...)`、等待和关闭。

- [ ] **Step 4: 运行完整验证**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`

Expected: 所有命令 PASS，结构检查无新增超限文件，旧 Core 测试与新 Runtime 测试全部通过。

- [ ] **Step 5: 检查 Workspace 未进入新模型**

Run: `rg -n "workspace|workspaceId" packages/core/src/domain packages/core/src/application packages/core/src/execution packages/core/src/sdk/runtime-plugin.ts packages/core/src/sdk/runtime-storage.ts`

Expected: 只有 `rem-agent-executor.ts` 中带有明确 `legacy adapter` 注释的过渡字段；新领域、用例和公开接口无匹配。

- [ ] **Step 6: 提交纵向切片验收**

```bash
git add packages/core/tests/agent-runtime-acceptance.test.ts docs/architecture.md docs/module-reference.md packages/core/README.md
git commit -m "test(core): verify persistent agent runtime slice"
```

## 完成定义

计划完成时必须同时满足：

- 业务调用方只使用 AgentRuntime、Session、Run、Context、Event 和 Artifact；
- 新 API 不接受 workspace；
- 同一 Run 可在进程重启后查询和恢复；
- SQLite transaction 保证 Run 状态与 Event 原子提交；
- 同一幂等请求不会创建重复 Run；
- Context 解析顺序、冲突和快照哈希确定；
- REMAgent 能使用 Context Plugin 提供的 Prompt 和工具；
- 不明确的非幂等工具副作用不会被盲目重试；
- 嵌入式端到端测试通过；
- `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure` 全绿。

## 后续独立计划

本计划完成后，按顺序另写并执行：

1. Service + 远程 TypeScript Client；
2. Workspace 能力迁移为 `workspace-context` Runtime Plugin，并删除 Core 旧 Workspace；
3. Team、child Agent、AgentThread 和 Delivery 迁移为 Run ExecutionStrategy；
4. Webhook/Outbox、外部事件和多 Worker；
5. Approval、Policy、Audit 与 Budget 治理能力；
6. Workbench 切换到远程 Client 和新 Runtime 观察模型。
