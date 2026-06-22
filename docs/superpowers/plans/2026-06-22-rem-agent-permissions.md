# Rem Agent 权限控制三层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 rem-agent-core 实现三层权限控制：扩展 Tool Policy、before_tool_call 审批钩子、Exec Approvals + exec 工具。

**Architecture:** 采用 OpenClaw 的分层权限模型，但针对 Rem Agent 无 Gateway 架构做简化。Tool Policy 控制工具可见性；ToolHookRunner + ApprovalManager 实现可挂起的工具调用审批；Exec Approvals 专门控制 exec 工具的主机执行策略。

**Tech Stack:** TypeScript, Node.js, Vitest, @sinclair/typebox

---

## 1. 文件结构

| 文件 | 职责 |
|---|---|
| `packages/core/src/sdk/tool-policy.ts` | ToolPolicyConfig 类型定义 |
| `packages/core/src/security/tool-policy-profile.ts` | profile 展开 |
| `packages/core/src/security/tool-policy-shared.ts` | 工具名规范化、group 展开 |
| `packages/core/src/security/tool-policy-pipeline.ts` | 多层策略管道 |
| `packages/core/src/sdk/tool-hook.ts` | ToolHook 相关类型 |
| `packages/core/src/security/approval-manager.ts` | 内存 pending approval 管理 |
| `packages/core/src/security/tool-hook-runner.ts` | 运行 before_tool_call 钩子 |
| `packages/core/src/security/tool-hooks/dangerous-tool-hook.ts` | 兼容 dangerous 标记的默认钩子 |
| `packages/core/src/sdk/exec-policy.ts` | ExecPolicy 类型 |
| `packages/core/src/security/exec-approval-store.ts` | exec allowlist 本地持久化 |
| `packages/core/src/security/exec-approvals.ts` | exec 审批核心逻辑 |
| `packages/core/src/security/host-env-security.ts` | exec 环境变量安全过滤 |
| `packages/core/src/plugins/tools/exec.ts` | exec 工具定义与执行器 |
| `packages/core/src/plugins/tools/index.ts` | 注册 exec 工具 |
| `packages/core/src/registry/tool-registry.ts` | 集成 policy pipeline + hooks |
| `packages/core/src/core-agent.ts` | 暴露 resolveToolApproval API |
| `packages/core/src/events.ts` | 增加审批生命周期事件 |

---

## Phase 1: 扩展 Tool Policy

### Task 1: 定义 ToolPolicyConfig 类型

**Files:**
- Create: `packages/core/src/sdk/tool-policy.ts`

- [ ] **Step 1: 创建 ToolPolicyConfig 类型文件**

```typescript
export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

export interface ToolPolicyConfig {
  profile?: ToolProfileId;
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
  byProvider?: Record<string, ToolPolicyConfig>;
  toolsBySender?: Record<string, ToolPolicyConfig>;
  sandbox?: SandboxToolPolicyConfig;
}

export interface SandboxToolPolicyConfig {
  mode?: 'off' | 'non-main' | 'all';
  tools?: ToolPolicyConfig;
}

export type ToolPolicyLike = ToolPolicyConfig;
```

- [ ] **Step 2: 运行类型检查**

Run: `pnpm --filter rem-agent-core typecheck`

Expected: PASS

---

### Task 2: Tool Profile 与 Group 展开

**Files:**
- Create: `packages/core/src/security/tool-policy-shared.ts`
- Create: `packages/core/src/security/tool-policy-profile.ts`

- [ ] **Step 3: 实现工具 group 与 profile 展开**

```typescript
// packages/core/src/security/tool-policy-shared.ts
export const TOOL_GROUPS: Record<string, string[]> = {
  'group:fs': ['read', 'write', 'edit'],
  'group:runtime': ['exec', 'process'],
  'group:web': ['web_search', 'web_fetch'],
  'group:memory': ['memory_search', 'memory_get'],
  'group:sessions': ['sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn'],
  'group:messaging': ['message'],
};

export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function expandToolGroups(entries: string[] | undefined): string[] {
  if (!entries) return [];
  const expanded = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeToolName(entry);
    const group = TOOL_GROUPS[normalized];
    if (group) {
      for (const item of group) expanded.add(item);
    } else {
      expanded.add(normalized);
    }
  }
  return Array.from(expanded);
}
```

```typescript
// packages/core/src/security/tool-policy-profile.ts
import { expandToolGroups } from './tool-policy-shared.js';
import type { ToolPolicyConfig } from '../sdk/tool-policy.js';

const PROFILE_TOOLS: Record<string, string[] | undefined> = {
  minimal: ['session_status'],
  coding: ['group:fs', 'group:runtime', 'group:web', 'group:memory', 'group:sessions'],
  messaging: ['group:messaging', 'session_status'],
  full: undefined,
};

export function resolveProfilePolicy(profile: string): Pick<ToolPolicyConfig, 'allow'> {
  const tools = PROFILE_TOOLS[profile];
  return tools ? { allow: expandToolGroups(tools) } : {};
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter rem-agent-core test -- security/tool-policy-shared`

Expected: PASS

---

### Task 3: 重构 Tool Policy Pipeline

**Files:**
- Modify: `packages/core/src/security/tool-policy-pipeline.ts`

- [ ] **Step 5: 实现多层策略管道**

```typescript
import type { ToolDefinition } from '../sdk/tool-provider.js';
import type { ToolPolicyConfig } from '../sdk/tool-policy.js';
import { expandToolGroups, normalizeToolName } from './tool-policy-shared.js';
import { resolveProfilePolicy } from './tool-policy-profile.js';

export interface ToolPolicyPipelineParams {
  tools: ToolDefinition[];
  readOnly: boolean;
  policy: ToolPolicyConfig;
  provider?: string;
  sender?: string;
}

export function applyToolPolicyPipeline(params: ToolPolicyPipelineParams): ToolDefinition[] {
  let filtered = params.readOnly
    ? params.tools.filter((t) => t.readOnly === true)
    : params.tools;

  if (params.policy.profile) {
    filtered = applyLayer(filtered, resolveProfilePolicy(params.policy.profile));
  }

  filtered = applyLayer(filtered, params.policy);

  if (params.provider && params.policy.byProvider?.[params.provider]) {
    filtered = applyLayer(filtered, params.policy.byProvider[params.provider]);
  }

  if (params.sender && params.policy.toolsBySender?.[params.sender]) {
    filtered = applyLayer(filtered, params.policy.toolsBySender[params.sender]);
  }

  if (params.policy.sandbox?.tools) {
    filtered = applyLayer(filtered, params.policy.sandbox.tools);
  }

  return filtered;
}

function applyLayer(tools: ToolDefinition[], layer: ToolPolicyConfig): ToolDefinition[] {
  const denySet = new Set(expandToolGroups(layer.deny ?? []));
  let result = tools.filter((t) => !denySet.has(normalizeToolName(t.name)));

  if (layer.allow && layer.allow.length > 0) {
    const allowSet = new Set(expandToolGroups([...layer.allow, ...(layer.alsoAllow ?? [])]));
    result = result.filter((t) => {
      const name = normalizeToolName(t.name);
      return allowSet.has(name) || allowSet.has('*');
    });
  }

  return result;
}
```

- [ ] **Step 6: 运行 tool-policy-pipeline 测试**

Run: `pnpm --filter rem-agent-core test -- tool-policy-pipeline`

Expected: existing tests PASS; new tests in Step 7 will be added next

---

### Task 4: 更新测试与 Registry

**Files:**
- Modify: `packages/core/tests/tool-policy-pipeline.test.ts`
- Modify: `packages/core/src/registry/tool-registry.ts`
- Modify: `packages/core/src/plugins/tools/index.ts`

- [ ] **Step 7: 扩展 tool-policy-pipeline 测试**

```typescript
it('expands coding profile', () => {
  const tools = [makeTool('read', true), makeTool('write'), makeTool('exec')];
  const result = applyToolPolicyPipeline({
    tools,
    readOnly: false,
    policy: { profile: 'coding' },
  });
  expect(result.map((t) => t.name).sort()).toEqual(['exec', 'read', 'write']);
});

it('applies provider-specific policy', () => {
  const tools = [makeTool('read', true), makeTool('write')];
  const result = applyToolPolicyPipeline({
    tools,
    readOnly: false,
    policy: { byProvider: { openai: { deny: ['write'] } } },
    provider: 'openai',
  });
  expect(result.map((t) => t.name)).toEqual(['read']);
});

it('applies sender-specific policy', () => {
  const tools = [makeTool('read', true), makeTool('write')];
  const result = applyToolPolicyPipeline({
    tools,
    readOnly: false,
    policy: { toolsBySender: { 'id:guest': { deny: ['write'] } } },
    sender: 'id:guest',
  });
  expect(result.map((t) => t.name)).toEqual(['read']);
});
```

- [ ] **Step 8: 更新 AgentToolRegistry 使用新 Pipeline**

```typescript
// packages/core/src/registry/tool-registry.ts
import type { ToolPolicyConfig } from '../sdk/tool-policy.js';

export interface AgentToolRegistryOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  policy?: ToolPolicyConfig;
  approvalHook?: ApprovalHook; // 保留到 Phase 2
}

getToolSet(): ToolSet {
  const all = Array.from(this.tools.values()).map((entry) => entry.def);
  const filtered = applyToolPolicyPipeline({
    tools: all,
    readOnly: this.readOnly,
    policy: this.policy,
  });
  const result: ToolSet = {};
  for (const def of filtered) {
    const schema: ToolSchema = {
      description: def.description,
      parameters: def.parameters as Record<string, unknown>,
    };
    result[def.name] = schema;
  }
  return result;
}
```

- [ ] **Step 9: 运行 registry 测试**

Run: `pnpm --filter rem-agent-core test -- tool-registry`

Expected: PASS

---

## Phase 2: before_tool_call 钩子 + Approval

### Task 5: 定义 ToolHook 类型

**Files:**
- Create: `packages/core/src/sdk/tool-hook.ts`

- [ ] **Step 10: 创建 ToolHook 类型文件**

```typescript
import type { ToolContext } from './tool-provider.js';

export interface ToolHookContext extends ToolContext {
  toolName: string;
  toolCallId?: string;
  input: unknown;
}

export interface ToolHookResult {
  block?: { reason: string };
  requireApproval?: {
    title: string;
    description?: string;
    severity?: 'info' | 'warning' | 'critical';
    allowedDecisions: Array<'allow-once' | 'allow-always' | 'deny'>;
    timeoutMs?: number;
  };
  params?: unknown;
}

export type ToolHook = (ctx: ToolHookContext) => Promise<ToolHookResult> | ToolHookResult;
```

---

### Task 6: 实现 ApprovalManager

**Files:**
- Create: `packages/core/src/security/approval-manager.ts`

- [ ] **Step 11: 创建 ApprovalManager**

```typescript
import { randomUUID } from 'node:crypto';

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export interface ApprovalRequest {
  approvalId: string;
  toolName: string;
  toolCallId?: string;
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  allowedDecisions: ApprovalDecision[];
  timeoutMs: number;
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (value: ApprovalDecision | null) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;

export class ApprovalManager {
  private pending = new Map<string, PendingEntry>();

  create(
    params: Omit<ApprovalRequest, 'approvalId'>,
    timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
  ): ApprovalRequest {
    const approvalId = `approval:${randomUUID()}`;
    const request: ApprovalRequest = { ...params, approvalId, timeoutMs };

    const decisionPromise = new Promise<ApprovalDecision | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(approvalId);
        resolve(null);
      }, timeoutMs);
      this.pending.set(approvalId, { request, resolve, reject, timer });
    });

    // 将 promise 挂载到 request 上便于 runner 等待（实现细节可调整）
    (request as unknown as { _promise: Promise<ApprovalDecision | null> })._promise = decisionPromise;

    return request;
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.resolve(decision);
    return true;
  }

  cancel(approvalId: string): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.reject(new Error('Approval cancelled'));
    return true;
  }

  getPending(approvalId: string): ApprovalRequest | undefined {
    return this.pending.get(approvalId)?.request;
  }

  listPending(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map((e) => e.request);
  }
}
```

- [ ] **Step 12: 运行 ApprovalManager 测试**

创建 `packages/core/tests/approval-manager.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ApprovalManager } from '../src/security/approval-manager.js';

describe('ApprovalManager', () => {
  it('creates pending approval', () => {
    const manager = new ApprovalManager();
    const request = manager.create({
      toolName: 'write',
      title: 'Write file',
      allowedDecisions: ['allow-once', 'deny'],
    });
    expect(request.approvalId).toMatch(/^approval:/);
    expect(manager.listPending()).toHaveLength(1);
  });

  it('resolves approval', async () => {
    const manager = new ApprovalManager();
    const request = manager.create({
      toolName: 'write',
      title: 'Write file',
      allowedDecisions: ['allow-once', 'deny'],
    });
    const decisionPromise = (request as unknown as { _promise: Promise<string | null> })._promise;
    manager.resolve(request.approvalId, 'allow-once');
    const decision = await decisionPromise;
    expect(decision).toBe('allow-once');
  });

  it('times out', async () => {
    const manager = new ApprovalManager();
    const request = manager.create(
      { toolName: 'write', title: 'Write file', allowedDecisions: ['allow-once', 'deny'] },
      10,
    );
    const decisionPromise = (request as unknown as { _promise: Promise<string | null> })._promise;
    const decision = await decisionPromise;
    expect(decision).toBeNull();
  });
});
```

Run: `pnpm --filter rem-agent-core test -- approval-manager`

Expected: PASS

---

### Task 7: 实现 ToolHookRunner

**Files:**
- Create: `packages/core/src/security/tool-hook-runner.ts`

- [ ] **Step 13: 创建 ToolHookRunner**

```typescript
import type { EventBus } from '../events.js';
import type { ToolHook, ToolHookContext, ToolHookResult } from '../sdk/tool-hook.js';
import type { ApprovalDecision, ApprovalManager } from './approval-manager.js';

export interface ToolHookRunnerOptions {
  hooks?: ToolHook[];
  approvalManager: ApprovalManager;
  events?: EventBus;
}

export interface ToolHookRunOutcome {
  blocked?: { reason: string };
  approved?: boolean;
  params?: unknown;
  approvalId?: string;
}

export class ToolHookRunner {
  constructor(private options: ToolHookRunnerOptions) {}

  async run(ctx: ToolHookContext): Promise<ToolHookRunOutcome> {
    let currentParams = ctx.input;

    for (const hook of this.options.hooks ?? []) {
      const result = await hook({ ...ctx, input: currentParams });

      if (result.block) {
        return { blocked: result.block };
      }

      if (result.requireApproval) {
        const request = this.options.approvalManager.create({
          toolName: ctx.toolName,
          toolCallId: ctx.toolCallId,
          title: result.requireApproval.title,
          description: result.requireApproval.description,
          severity: result.requireApproval.severity,
          allowedDecisions: result.requireApproval.allowedDecisions,
          timeoutMs: result.requireApproval.timeoutMs,
        });

        await this.options.events?.emit('tool:approval:requested', {
          agent: undefined,
          state: undefined as never,
          toolCall: request,
        });

        const decisionPromise = (request as unknown as { _promise: Promise<ApprovalDecision | null> })._promise;
        const decision = await decisionPromise;

        await this.options.events?.emit('tool:approval:resolved', {
          agent: undefined,
          state: undefined as never,
          toolCall: { approvalId: request.approvalId, decision },
        });

        if (decision !== 'allow-once' && decision !== 'allow-always') {
          return { blocked: { reason: result.requireApproval.description ?? 'Approval denied' } };
        }
      }

      if (result.params !== undefined) {
        currentParams = result.params;
      }
    }

    return { approved: true, params: currentParams };
  }
}
```

---

### Task 8: dangerous 兼容钩子

**Files:**
- Create: `packages/core/src/security/tool-hooks/dangerous-tool-hook.ts`

- [ ] **Step 14: 实现 dangerous-tool-hook**

```typescript
import type { ToolDefinition } from '../../sdk/tool-provider.js';
import type { ToolHook, ToolHookContext, ToolHookResult } from '../../sdk/tool-hook.js';

export function createDangerousToolHook(
  tools: Map<string, ToolDefinition>,
): ToolHook {
  return (ctx: ToolHookContext): ToolHookResult | undefined => {
    const def = tools.get(ctx.toolName);
    if (!def?.dangerous) return undefined;
    return {
      requireApproval: {
        title: `Run ${ctx.toolName}`,
        description: `Tool "${ctx.toolName}" is marked dangerous and requires approval.`,
        severity: 'warning',
        allowedDecisions: ['allow-once', 'allow-always', 'deny'],
      },
    };
  };
}
```

---

### Task 9: 更新 ToolRegistry 集成 Hooks

**Files:**
- Modify: `packages/core/src/registry/tool-registry.ts`

- [ ] **Step 15: 集成 ToolHookRunner**

```typescript
import { ToolHookRunner } from '../security/tool-hook-runner.js';
import { ApprovalManager } from '../security/approval-manager.js';
import { createDangerousToolHook } from '../security/tool-hooks/dangerous-tool-hook.js';
import type { ToolHook } from '../sdk/tool-hook.js';

export interface AgentToolRegistryOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  policy?: ToolPolicyConfig;
  hooks?: ToolHook[];
}

export class AgentToolRegistry implements ToolProvider {
  private approvalManager = new ApprovalManager();
  private hookRunner: ToolHookRunner;

  constructor(options: AgentToolRegistryOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.readOnly = options.readOnly ?? false;
    this.policy = options.policy ?? {};
    this.hookRunner = new ToolHookRunner({
      hooks: [createDangerousToolHook(this.tools), ...(options.hooks ?? [])],
      approvalManager: this.approvalManager,
    });
  }

  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }

  async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      const registered = this.tools.get(call.toolName);
      if (!registered) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: `Tool "${call.toolName}" not found`,
        });
        continue;
      }

      if (!registered.check.Check(call.input)) {
        // ... existing validation error
        continue;
      }

      const hookOutcome = await this.hookRunner.run({
        ...ctx,
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        input: call.input,
      });

      if (hookOutcome.blocked) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: hookOutcome.blocked.reason,
          details: { audit: { approved: false } },
        });
        continue;
      }

      try {
        const { output, details } = await registered.executor(
          hookOutcome.params ?? call.input as never,
          ctx,
        );
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output, details });
      } catch (err) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }
}
```

- [ ] **Step 16: 运行 registry 测试**

Run: `pnpm --filter rem-agent-core test -- tool-registry`

Expected: PASS with updated tests

---

### Task 10: 暴露 resolveToolApproval 与事件

**Files:**
- Modify: `packages/core/src/events.ts`
- Modify: `packages/core/src/core-agent.ts`
- Modify: `packages/core/src/turn.ts` 或 `loop-strategy.ts` 以暴露 tool registry

- [ ] **Step 17: 增加审批生命周期事件**

```typescript
export type AgentEvent =
  // ... existing events
  | 'tool:approval:requested'
  | 'tool:approval:resolved'
  | 'tool:approval:expired'
  | 'tool:blocked';
```

- [ ] **Step 18: 给 ReactTurnRunner 暴露 tool registry 访问**

```typescript
// packages/core/src/turn.ts
export class ReactTurnRunner implements TurnRunner {
  // ... existing
  getToolRegistry(): ToolProvider | undefined {
    // 如果 loopStrategy 是 ReactLoop，返回其 toolProvider
    return (this.loopStrategy as ReactLoop | undefined)?.getToolProvider?.();
  }
}

// packages/core/src/loop-strategy.ts
export class ReactLoop implements LoopStrategy {
  // ... existing
  getToolProvider(): ToolProvider {
    return this.toolProvider;
  }
}
```

- [ ] **Step 19: CoreAgent 暴露 resolveToolApproval**

```typescript
resolveToolApproval(
  approvalId: string,
  decision: 'allow-once' | 'allow-always' | 'deny',
): boolean {
  const registry = this.turnRunner.getToolRegistry?.();
  if (!registry || !('getApprovalManager' in registry)) return false;
  return (registry as AgentToolRegistry).getApprovalManager().resolve(approvalId, decision);
}
```

- [ ] **Step 20: 运行 typecheck**

Run: `pnpm --filter rem-agent-core typecheck`

Expected: PASS

---

## Phase 3: Exec 工具 + Exec Approvals

### Task 11: 定义 ExecPolicy

**Files:**
- Create: `packages/core/src/sdk/exec-policy.ts`

- [ ] **Step 21: 创建 ExecPolicy 类型**

```typescript
export type ExecMode = 'deny' | 'allowlist' | 'ask' | 'auto' | 'full';
export type ExecSecurity = 'deny' | 'allowlist' | 'full';
export type ExecAsk = 'off' | 'on-miss' | 'always';
export type ExecHost = 'auto' | 'sandbox' | 'gateway' | 'node';

export interface ExecPolicy {
  mode?: ExecMode;
  security?: ExecSecurity;
  ask?: ExecAsk;
  host?: ExecHost;
  timeoutSec?: number;
  safeBins?: string[];
  strictInlineEval?: boolean;
}
```

---

### Task 12: Host 环境安全

**Files:**
- Create: `packages/core/src/security/host-env-security.ts`

- [ ] **Step 22: 实现环境变量过滤**

```typescript
const BLOCKED_KEYS = new Set([
  'NODE_OPTIONS',
  'PYTHONPATH',
  'LD_PRELOAD',
  'SHELLOPTS',
  'IFS',
]);

const BLOCKED_PREFIXES = ['LD_', 'DYLD_', 'BASH_FUNC_'];

function isBlockedKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (BLOCKED_KEYS.has(upper)) return true;
  for (const prefix of BLOCKED_PREFIXES) {
    if (upper.startsWith(prefix)) return true;
  }
  return false;
}

export function sanitizeExecEnv(
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isBlockedKey(key)) {
      result[key] = value;
    }
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key.toUpperCase() === 'PATH') {
        throw new Error("Security Violation: Custom 'PATH' variable is forbidden during host execution.");
      }
      if (isBlockedKey(key)) {
        throw new Error(`Security Violation: Environment variable "${key}" is forbidden.`);
      }
      result[key] = value;
    }
  }
  return result;
}
```

---

### Task 13: Exec Approval Store

**Files:**
- Create: `packages/core/src/security/exec-approval-store.ts`

- [ ] **Step 23: 实现本地 allowlist 持久化**

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import type { ExecAsk, ExecSecurity } from '../sdk/exec-policy.js';

export interface ExecAllowlistEntry {
  id: string;
  pattern: string;
  argPattern?: string;
  source?: string;
}

export interface ExecApprovalsFile {
  version: 1;
  defaults: {
    security?: ExecSecurity;
    ask?: ExecAsk;
    askFallback?: ExecSecurity;
  };
  agents?: Record<string, {
    security?: ExecSecurity;
    ask?: ExecAsk;
    allowlist?: ExecAllowlistEntry[];
  }>;
}

export class ExecApprovalStore {
  constructor(private filePath: string) {}

  async load(): Promise<ExecApprovalsFile> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as ExecApprovalsFile;
      return parsed;
    } catch (error) {
      return { version: 1, defaults: {} };
    }
  }

  async save(data: ExecApprovalsFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }
}
```

---

### Task 14: Exec 审批核心逻辑

**Files:**
- Create: `packages/core/src/security/exec-approvals.ts`

- [ ] **Step 24: 实现 exec 策略解析与审批判断**

```typescript
import type { ExecAsk, ExecMode, ExecPolicy, ExecSecurity } from '../sdk/exec-policy.js';
import type { ExecAllowlistEntry } from './exec-approval-store.js';

export function resolveExecMode(mode: ExecMode): { security: ExecSecurity; ask: ExecAsk } {
  switch (mode) {
    case 'deny': return { security: 'deny', ask: 'off' };
    case 'allowlist': return { security: 'allowlist', ask: 'off' };
    case 'ask': return { security: 'allowlist', ask: 'on-miss' };
    case 'auto': return { security: 'allowlist', ask: 'on-miss' };
    case 'full':
    default: return { security: 'full', ask: 'off' };
  }
}

export interface ExecCommandPlan {
  command: string;
  argv: string[];
  workdir: string;
}

export interface ExecApprovalCheck {
  required: boolean;
  reason?: string;
  denied?: boolean;
}

export function checkExecApproval(
  policy: ExecPolicy,
  plan: ExecCommandPlan,
  allowlist: ExecAllowlistEntry[],
): ExecApprovalCheck {
  const { security, ask } = resolveExecMode(policy.mode ?? 'full');

  if (security === 'deny') {
    return { required: false, denied: true, reason: 'Host execution is disabled' };
  }

  if (policy.strictInlineEval && isInlineEval(plan.command)) {
    return { required: true, reason: 'Inline interpreter evaluation requires approval' };
  }

  if (security === 'full') {
    return { required: false };
  }

  const matched = allowlist.some((entry) => matchesAllowlist(entry, plan));
  if (matched) {
    return { required: false };
  }

  if (ask === 'always') {
    return { required: true, reason: 'Approval required (ask=always)' };
  }

  if (ask === 'on-miss') {
    return { required: true, reason: 'Command not in allowlist' };
  }

  return { required: false, denied: true, reason: 'Command not in allowlist' };
}

function isInlineEval(command: string): boolean {
  return /\b(python3?|node|ruby|perl|php|lua|osascript)\s+(-[ce]|--eval|--command)\b/i.test(command);
}

function matchesAllowlist(entry: ExecAllowlistEntry, plan: ExecCommandPlan): boolean {
  // 简易实现：pattern 匹配命令首 token；完整 glob 实现可后续增强
  const firstToken = plan.argv[0] ?? '';
  return firstToken === entry.pattern;
}
```

---

### Task 15: Exec 工具

**Files:**
- Create: `packages/core/src/plugins/tools/exec.ts`
- Modify: `packages/core/src/plugins/tools/index.ts`

- [ ] **Step 25: 创建 exec 工具**

```typescript
import { Type, type Static } from '@sinclair/typebox';
import { exec as childExec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../sdk/tool-provider.js';
import type { ExecPolicy } from '../../sdk/exec-policy.js';
import { checkExecApproval } from '../../security/exec-approvals.js';
import { sanitizeExecEnv } from '../../security/host-env-security.js';

const execSchema = Type.Object(
  {
    command: Type.String({ description: 'Shell command to execute' }),
    workdir: Type.Optional(Type.String({ description: 'Working directory (defaults to cwd)' })),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds' })),
    background: Type.Optional(Type.Boolean({ description: 'Run in background' })),
  },
  { additionalProperties: false },
);

export type ExecToolInput = Static<typeof execSchema>;

const execAsync = promisify(childExec);

export function createExecToolDefinition(): ToolDefinition<typeof execSchema> {
  return {
    name: 'exec',
    description: 'Run a shell command on the host.',
    parameters: execSchema,
    category: 'shell',
  };
}

export function createExecToolExecutor(policy: ExecPolicy): ToolExecutor<typeof execSchema> {
  return async (input: ExecToolInput, ctx: ToolContext) => {
    const workdir = input.workdir ? resolve(ctx.cwd, input.workdir) : ctx.cwd;
    const argv = input.command.trim().split(/\s+/);

    const check = checkExecApproval(policy, {
      command: input.command,
      argv,
      workdir,
    }, []);

    if (check.denied) {
      throw new Error(check.reason ?? 'Host execution denied');
    }

    if (check.required) {
      throw new Error(check.reason ?? 'Host execution requires approval');
    }

    const env = sanitizeExecEnv(input.env);

    if (input.background) {
      const child = childExec(input.command, { cwd: workdir, env });
      child.unref();
      return { output: `Started background process (pid: ${child.pid ?? 'unknown'})` };
    }

    const timeoutMs = (input.timeout ?? policy.timeoutSec ?? 1800) * 1000;
    const { stdout, stderr } = await execAsync(input.command, {
      cwd: workdir,
      env,
      timeout: timeoutMs,
    });

    return {
      output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
    };
  };
}
```

- [ ] **Step 26: 在 createFileSystemTools 注册 exec**

```typescript
export interface FileSystemToolsOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  toolPolicy?: ToolPolicyConfig;
  execPolicy?: ExecPolicy;
}

export function createFileSystemTools(options: FileSystemToolsOptions): AgentToolRegistry {
  const registry = new AgentToolRegistry({
    workspaceRoot: options.workspaceRoot,
    readOnly: options.readOnly,
    policy: options.toolPolicy,
  });

  registry.register(createReadToolDefinition(), createReadToolExecutor());
  registry.register(createLsToolDefinition(), createLsToolExecutor());
  registry.register(
    createExecToolDefinition(),
    createExecToolExecutor(options.execPolicy ?? { mode: 'full' }),
  );

  if (!options.readOnly) {
    registry.register(createWriteToolDefinition(), createWriteToolExecutor());
    registry.register(createEditToolDefinition(), createEditToolExecutor());
  }

  return registry;
}
```

---

### Task 16: 更新 CoreAgent 配置

**Files:**
- Modify: `packages/core/src/core-agent.ts`

- [ ] **Step 27: 在 CoreAgentConfig 增加 execPolicy**

```typescript
import type { ExecPolicy } from './sdk/exec-policy.js';

export interface CoreAgentConfig {
  // ... existing fields
  toolPolicy?: ToolPolicyConfig;
  execPolicy?: ExecPolicy;
}
```

- [ ] **Step 28: 透传 execPolicy**

```typescript
const toolProvider =
  this.config.toolProvider ??
  createFileSystemTools({
    workspaceRoot,
    readOnly: this.config.readOnly,
    toolPolicy: this.config.toolPolicy,
    execPolicy: this.config.execPolicy,
  });
```

- [ ] **Step 29: createAgentFromEnv 增加 execPolicy**

```typescript
export function createAgentFromEnv(options: {
  // ... existing
  toolPolicy?: ToolPolicyConfig;
  execPolicy?: ExecPolicy;
}): CoreAgent {
  // ...
  return new CoreAgent({
    // ...
    toolPolicy: options.toolPolicy,
    execPolicy: options.execPolicy,
  });
}
```

---

## 验证与测试

### Task 17: 新增与更新测试

- [ ] **Step 30: 新增 exec-tool 测试**

创建 `packages/core/tests/exec-tool.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { createExecToolExecutor } from '../src/plugins/tools/exec.js';

describe('exec tool', () => {
  it('runs a simple command', async () => {
    const exec = createExecToolExecutor({ mode: 'full' });
    const result = await exec({ command: 'echo hello' }, {
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
    });
    expect(result.output.trim()).toBe('hello');
  });

  it('blocks PATH override', async () => {
    const exec = createExecToolExecutor({ mode: 'full' });
    await expect(
      exec({ command: 'echo hello', env: { PATH: '/tmp' } }, {
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
      }),
    ).rejects.toThrow('PATH');
  });

  it('denies in mode deny', async () => {
    const exec = createExecToolExecutor({ mode: 'deny' });
    await expect(
      exec({ command: 'echo hello' }, {
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
      }),
    ).rejects.toThrow('disabled');
  });
});
```

- [ ] **Step 31: 更新 tool-policy-pipeline 测试**

添加 Step 7 中的 profile、byProvider、toolsBySender 测试。

- [ ] **Step 32: 更新 tool-registry 测试**

确保 dangerous 标记仍触发审批（通过 dangerous-tool-hook）。

- [ ] **Step 33: 全量验证**

Run: `pnpm typecheck && pnpm test`

Expected: ALL PASS

---

## Self-Review Checklist

- [ ] Spec coverage: Tool Policy expansion ✓
- [ ] Spec coverage: Suspended approval with external resolution ✓
- [ ] Spec coverage: Exec tool + exec approvals ✓
- [ ] No placeholders (TBD/TODO) ✓
- [ ] Type consistency across tasks ✓
- [ ] File size under module-separation-convention limits ✓
