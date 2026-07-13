# REM 子 Agent 支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 REM 支持通过内置 `delegate_task` 工具层级委派子 Agent，子 Agent 拥有独立会话并返回 XML 结果。

**Architecture:** 在 `runAgent` 内部用 `OverlayToolProvider` 为当前运行注入 `delegate_task` 工具；工具 executor 创建子会话、派生 `auto` 安全模式的子上下文、调用 `runAgent` 递归运行，并通过 `AgentState` 广播 `child-agent-update` 事件；Web 层消费该事件展示子 Agent 进度卡片。

**Tech Stack:** TypeScript, pnpm, Vitest, Next.js 15, React 19, `@sinclair/typebox`, `@testing-library/react`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/core/src/bus-events.ts` | 新增 `child-agent-update` BusEvent 类型 |
| `packages/core/src/sub-agent/build-child-context.ts` | 从父 `AgentContext` 派生 `securityMode='auto'` 的子上下文 |
| `packages/core/src/sub-agent/format-task-result.ts` | 把子 Agent 结果包装成 XML |
| `packages/core/src/plugins/tool/builtin/delegate-task.ts` | `delegate_task` 工具定义 + executor 工厂 |
| `packages/core/src/run-agent.ts` | 在 `runAgent` 中注入 `delegate_task` overlay |
| `packages/bridge/src/types.ts` | `SessionSummary` 增加 `parentSessionId` |
| `packages/bridge/src/agent-session.ts` | 从 session metadata 读取 `parentSessionId` |
| `packages/web/src/lib/use-agents.ts` | 处理 `child-agent-update`，维护 `childAgents` 与 sidebar 列表 |
| `packages/web/src/components/chat/child-agent-card.tsx` | 父会话中的子 Agent 进度卡片 |
| `packages/web/src/components/chat/message-item.tsx` | 在 assistant 消息中渲染 `ChildAgentCard` |
| `packages/web/src/components/sidebar/session-item.tsx` | 可选：子会话标识 |

---

### Task 1: 新增 `child-agent-update` BusEvent

**Files:**
- Modify: `packages/core/src/bus-events.ts`

- [ ] **Step 1: 修改 `BusEvent` 联合类型**

```typescript
export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity }
  | { workspace: string; sessionId: string; type: 'snapshot'; messageId: string; parts: ContentPart[] }
  | { workspace: string; sessionId: string; type: 'usage-change'; usage: LanguageModelUsage }
  | {
      workspace: string;
      sessionId: string;
      type: 'child-agent-update';
      childSessionId: string;
      summary: string;
      status: 'running' | 'completed' | 'failed';
      tokenUsage?: LanguageModelUsage;
    };
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/bus-events.ts
git commit -m "feat(core): add child-agent-update bus event"
```

---

### Task 2: `SessionSummary` 增加 `parentSessionId`

**Files:**
- Modify: `packages/bridge/src/types.ts`
- Modify: `packages/bridge/src/agent-session.ts`

- [ ] **Step 1: 修改 `SessionSummary` 类型**

```typescript
export interface SessionSummary {
  sessionId: string;
  workspace: string;
  title?: string;
  pinned?: boolean;
  updatedAt: number;
  messageCount: number;
  activity?: SessionActivity;
  tokenUsage?: LanguageModelUsage;
  parentSessionId?: string;
}
```

- [ ] **Step 2: 修改 `AgentSessionManager.toSummary`**

```typescript
private toSummary(
  session: { sessionId: string; metadata?: Record<string, unknown>; updatedAt: Date; conversation?: unknown[] },
  workspace?: string,
): SessionSummary {
  return {
    sessionId: session.sessionId,
    workspace: workspace ?? (session.metadata?.workspace as string | undefined) ?? 'default',
    title: (session.metadata?.title as string | undefined) ?? 'New Chat',
    pinned: session.metadata?.pinned as boolean | undefined,
    parentSessionId: session.metadata?.parentSessionId as string | undefined,
    updatedAt: session.updatedAt.getTime(),
    messageCount: Array.isArray(session.conversation) ? session.conversation.length : 0,
  };
}
```

- [ ] **Step 3: 运行类型检查**

```bash
pnpm --filter rem-agent-bridge typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/bridge/src/types.ts packages/bridge/src/agent-session.ts
git commit -m "feat(bridge): expose parentSessionId in SessionSummary"
```

---

### Task 3: 创建子上下文派生模块

**Files:**
- Create: `packages/core/src/sub-agent/build-child-context.ts`

- [ ] **Step 1: 新建文件**

```typescript
import type { AgentContext } from '../agent-context.js';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { AgentModelConfig, AgentToolConfig, AgentConfig, ResolvedModelConfig, ResolvedAgentConfig, AgentBehaviorConfig, McpServerConfig } from '../sdk/config-provider.js';
import type { SystemPromptAssembler, PromptBuildContext } from '../sdk/system-prompt.js';
import { createPermissionEvaluator } from '../security/permissions/factory.js';
import type { SecurityMode } from '../security/permissions/factory.js';

export interface BuildChildContextOptions {
  maxTurns?: number;
  systemPrompt?: string;
}

class ChildConfigProvider implements ConfigProvider {
  constructor(
    private parent: ConfigProvider,
    private overrides: { maxTurns?: number },
  ) {}

  getConfig(): ResolvedAgentConfig {
    return { ...this.parent.getConfig(), ...this.getBehaviorConfig() };
  }

  getModelConfig(modelId?: string): ResolvedModelConfig {
    return this.parent.getModelConfig(modelId);
  }

  getToolConfig(): AgentToolConfig {
    return this.parent.getToolConfig();
  }

  getBehaviorConfig(): Required<AgentBehaviorConfig> {
    const base = this.parent.getBehaviorConfig();
    return { ...base, maxTurns: this.overrides.maxTurns ?? base.maxTurns };
  }

  getMcpConfig(): Record<string, McpServerConfig> {
    return this.parent.getMcpConfig();
  }
}

class StaticSystemPromptAssembler implements SystemPromptAssembler {
  constructor(private prompt: string) {}

  async render(_ctx: PromptBuildContext): Promise<string> {
    return this.prompt;
  }
}

export function buildChildContext(
  parentCtx: AgentContext,
  options?: BuildChildContextOptions,
): AgentContext {
  const childConfigProvider = new ChildConfigProvider(parentCtx.configProvider, {
    maxTurns: options?.maxTurns,
  });
  const permissionEvaluator = createPermissionEvaluator(
    'auto' as SecurityMode,
    parentCtx.ruleEngine,
  );

  return {
    ...parentCtx,
    configProvider: childConfigProvider,
    securityMode: 'auto',
    permissionEvaluator,
    systemPromptAssembler: options?.systemPrompt
      ? new StaticSystemPromptAssembler(options.systemPrompt)
      : parentCtx.systemPromptAssembler,
  };
}
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sub-agent/build-child-context.ts
git commit -m "feat(core): add buildChildContext helper"
```

---

### Task 4: 创建 XML 结果格式化模块

**Files:**
- Create: `packages/core/src/sub-agent/format-task-result.ts`

- [ ] **Step 1: 新建文件**

```typescript
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface FormatTaskResultParams {
  childSessionId: string;
  task: string;
  content: string;
  failed?: boolean;
}

export function formatTaskResult(params: FormatTaskResultParams): string {
  const state = params.failed ? 'failed' : 'completed';
  return `<task id="${params.childSessionId}" state="${state}">\n  <summary>${escapeXml(params.task)}</summary>\n  <task_result>\n${params.content}\n  </task_result>\n</task>`;
}
```

- [ ] **Step 2: 写单元测试**

Create: `packages/core/tests/sub-agent/format-task-result.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { formatTaskResult } from '../../src/sub-agent/format-task-result.js';

describe('formatTaskResult', () => {
  it('formats completed result', () => {
    const result = formatTaskResult({ childSessionId: 'c-1', task: 'search', content: 'found' });
    expect(result).toContain('<task id="c-1" state="completed">');
    expect(result).toContain('<summary>search</summary>');
    expect(result).toContain('<task_result>\nfound\n  </task_result>');
  });

  it('escapes XML in summary', () => {
    const result = formatTaskResult({ childSessionId: 'c-1', task: 'a < b', content: 'ok' });
    expect(result).toContain('<summary>a &lt; b</summary>');
  });

  it('marks failed state', () => {
    const result = formatTaskResult({ childSessionId: 'c-1', task: 'search', content: 'error', failed: true });
    expect(result).toContain('state="failed"');
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test packages/core/tests/sub-agent/format-task-result.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sub-agent/format-task-result.ts packages/core/tests/sub-agent/format-task-result.test.ts
git commit -m "feat(core): add task result XML formatter"
```

---

### Task 5: 创建 `delegate_task` 工具

**Files:**
- Create: `packages/core/src/plugins/tool/builtin/delegate-task.ts`

- [ ] **Step 1: 新建文件**

```typescript
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { LanguageModelUsage } from '../../../types.js';
import type { AgentContext } from '../../../agent-context.js';
import type { AgentState } from '../../../agent-state.js';
import type { BusEvent } from '../../../bus-events.js';
import { runAgent } from '../../../run-agent.js';
import { buildChildContext } from '../../../sub-agent/build-child-context.js';
import { formatTaskResult } from '../../../sub-agent/format-task-result.js';

const delegateTaskSchema = Type.Object(
  {
    task: Type.String({ description: 'Task description to delegate to the sub-agent.' }),
    systemPrompt: Type.Optional(Type.String({ description: 'Optional system prompt override for the sub-agent.' })),
    maxTurns: Type.Optional(Type.Number({ description: 'Optional max turns for the sub-agent.' })),
  },
  { additionalProperties: false },
);

export type DelegateTaskInput = Static<typeof delegateTaskSchema>;

export function createDelegateTaskToolDefinition(): ToolDefinition<typeof delegateTaskSchema> {
  return {
    name: 'delegate_task',
    description: 'Delegate an independent task to a sub-agent. The sub-agent runs in its own session, inherits the current model and tools, and returns the result when completed.',
    parameters: delegateTaskSchema,
    readOnly: false,
  };
}

export function createDelegateTaskToolExecutor(
  parentCtx: AgentContext,
  agentState: AgentState,
  workspace: string,
): ToolExecutor<typeof delegateTaskSchema> {
  return async (input: DelegateTaskInput, toolCtx: ToolContext) => {
    const parentSessionId = toolCtx.sessionId;
    if (!parentSessionId) {
      throw new Error('delegate_task requires a sessionId in tool context');
    }

    const childSession = await parentCtx.sessionProvider.create();
    const childSessionId = childSession.sessionId;
    childSession.metadata.parentSessionId = parentSessionId;
    childSession.metadata.workspace = workspace;
    childSession.metadata.title = input.task.slice(0, 50);
    await parentCtx.sessionProvider.save(childSession);

    const childCtx = buildChildContext(parentCtx, {
      maxTurns: input.maxTurns,
      systemPrompt: input.systemPrompt,
    });

    const run = runAgent({
      input: { content: input.task, timestamp: new Date() },
      sessionId: childSessionId,
      ctx: childCtx,
      agentState,
      workspace,
      workspaceRoot: toolCtx.workspaceRoot,
      signal: toolCtx.signal,
    });

    let failed = false;
    let lastTokenUsage: LanguageModelUsage | undefined;

    const handleChildEvent = (event: BusEvent) => {
      if (event.sessionId !== childSessionId) return;
      if (event.type === 'usage-change') {
        lastTokenUsage = event.usage;
      } else if (event.type === 'session-error') {
        failed = true;
      }
      if (event.type === 'usage-change' || event.type === 'activity-change') {
        agentState.publish({
          workspace,
          sessionId: parentSessionId,
          type: 'child-agent-update',
          childSessionId,
          summary: input.task,
          status: failed ? 'failed' : 'running',
          tokenUsage: lastTokenUsage,
        });
      }
    };

    const unsubscribe = agentState.subscribe(handleChildEvent);

    try {
      const output = await run.output;
      const childState = agentState.get(childSessionId);
      lastTokenUsage = childState?.tokenUsage ?? lastTokenUsage;
      agentState.publish({
        workspace,
        sessionId: parentSessionId,
        type: 'child-agent-update',
        childSessionId,
        summary: input.task,
        status: failed ? 'failed' : 'completed',
        tokenUsage: lastTokenUsage,
      });
      return {
        output: formatTaskResult({
          childSessionId,
          task: input.task,
          content: output.content,
          failed,
        }),
      };
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      agentState.publish({
        workspace,
        sessionId: parentSessionId,
        type: 'child-agent-update',
        childSessionId,
        summary: input.task,
        status: 'failed',
        tokenUsage: lastTokenUsage,
      });
      return {
        output: formatTaskResult({
          childSessionId,
          task: input.task,
          content: message,
          failed: true,
        }),
      };
    } finally {
      unsubscribe();
    }
  };
}
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/tool/builtin/delegate-task.ts
git commit -m "feat(core): add delegate_task tool"
```

---

### Task 6: 在 `runAgent` 中注入 `delegate_task` overlay

**Files:**
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: 在 `run-agent.ts` 中引入依赖**

在文件顶部添加：

```typescript
import { OverlayToolProvider } from './overlay-tool-provider.js';
import {
  createDelegateTaskToolDefinition,
  createDelegateTaskToolExecutor,
} from './plugins/tool/builtin/delegate-task.js';
```

- [ ] **Step 2: 在 `runAgent` 里注册 overlay**

在 `const effectiveToolProvider = toolComposer.compose({...});` 之后添加：

```typescript
const toolProviderWithDelegate = new OverlayToolProvider(effectiveToolProvider);
const delegateToolDefinition = createDelegateTaskToolDefinition();
const delegateToolExecutor = createDelegateTaskToolExecutor(ctx, params.agentState, workspace);
toolProviderWithDelegate.register(delegateToolDefinition, delegateToolExecutor);
```

- [ ] **Step 3: 将后续所有 `effectiveToolProvider` 引用替换为 `toolProviderWithDelegate`**

具体替换：

```typescript
// 原来
const toolSet = effectiveToolProvider.getToolSet();
// 改为
const toolSet = toolProviderWithDelegate.getToolSet();
```

```typescript
// 原来
execute: (calls: ToolCall[]) => executeTools({
  ...,
  toolProvider: effectiveToolProvider,
  ...,
})
// 改为
execute: (calls: ToolCall[]) => executeTools({
  ...,
  toolProvider: toolProviderWithDelegate,
  ...,
})
```

- [ ] **Step 4: 运行类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/run-agent.ts
git commit -m "feat(core): inject delegate_task into every runAgent run"
```

---

### Task 7: Core 层 `delegate_task` 集成测试

**Files:**
- Create: `packages/core/tests/delegate-task-tool.test.ts`

- [ ] **Step 1: 新建测试文件**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createDelegateTaskToolExecutor, createDelegateTaskToolDefinition } from '../src/plugins/tool/builtin/delegate-task.js';
import { InMemorySessionProvider } from '../src/plugins/session/in-memory/index.js';
import { AgentState } from '../src/src/agent-state.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';
import type { AgentContext } from '../src/agent-context.js';

describe('delegate_task tool', () => {
  it('creates a child session and returns XML result', async () => {
    const savedSessions: any[] = [];
    const sessionProvider = new InMemorySessionProvider();
    const saved = sessionProvider.save.bind(sessionProvider);
    sessionProvider.save = async (session) => {
      savedSessions.push(session);
      return saved(session);
    };

    const agentState = new AgentState();
    const mockCtx = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
      },
      sessionProvider,
      toolProvider: { getToolSet: () => ({}), register: () => {} },
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 10, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: any[]) => msgs },
      errorHandler: { classify: () => 'unknown', isRetryable: () => false },
      titleProvider: { generateTitle: async () => undefined },
      mcpManager: { connectAll: async () => [], closeAll: async () => {} },
      fileMutationQueue: createFileMutationQueue(),
      systemPromptAssembler: { assemble: async () => 'mock system prompt' },
      toolComposer: { compose: () => ({ getToolSet: () => ({}), execute: async () => [], register: () => {}, isDangerous: () => false }) },
      mcpProviders: [],
      ruleEngine: { evaluate: () => 'allow', checkOutsideAllowed: () => false, addRule: () => {} } as any,
      ruleStore: { saveApproved: async () => {}, loadAll: async () => [] } as any,
      permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) } as any,
      securityMode: 'interactive' as const,
      loopStrategy: {
        run: async () => ({ content: 'child result', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
      },
    } as unknown as AgentContext;

    const executor = createDelegateTaskToolExecutor(mockCtx, agentState, 'default');
    const result = await executor({ task: 'do sub work' }, { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 'parent-1' });

    expect(result.output).toContain('<task id="');
    expect(result.output).toContain('state="completed"');
    expect(result.output).toContain('<summary>do sub work</summary>');
    expect(result.output).toContain('<task_result>\nchild result\n  </task_result>');
    expect(savedSessions.length).toBeGreaterThan(0);
    expect(savedSessions[0].metadata.parentSessionId).toBe('parent-1');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test packages/core/tests/delegate-task-tool.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/delegate-task-tool.test.ts
git commit -m "test(core): add delegate_task integration test"
```

---

### Task 8: Bridge 层 `parentSessionId` 测试

**Files:**
- Create: `packages/bridge/tests/agent-session-parent-id.test.ts`

- [ ] **Step 1: 新建测试文件**

```typescript
import { describe, it, expect } from 'vitest';
import { AgentSessionManager } from '../src/agent-session.js';
import { InMemorySessionProvider } from 'rem-agent-core';
import { AgentState } from 'rem-agent-core';

describe('AgentSessionManager parentSessionId', () => {
  it('exposes parentSessionId in summary', async () => {
    const sessionProvider = new InMemorySessionProvider();
    const agentState = new AgentState();
    const manager = new AgentSessionManager(sessionProvider, agentState);

    const session = await sessionProvider.create();
    session.metadata.parentSessionId = 'parent-1';
    session.metadata.workspace = 'default';
    await sessionProvider.save(session);

    const list = await manager.listSessions('default');
    expect(list[0].parentSessionId).toBe('parent-1');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test packages/bridge/tests/agent-session-parent-id.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/tests/agent-session-parent-id.test.ts
git commit -m "test(bridge): verify parentSessionId in SessionSummary"
```

---

### Task 9: Web 层处理 `child-agent-update`

**Files:**
- Modify: `packages/web/src/lib/use-agents.ts`

- [ ] **Step 1: 扩展 `SessionState`**

```typescript
interface SessionState {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingToolCalls: Set<string>;
  pendingApprovals: ApprovalRequest[];
  tokenUsage?: LanguageModelUsage;
  childAgents: Map<string, {
    childSessionId: string;
    summary: string;
    status: 'running' | 'completed' | 'failed';
    tokenUsage?: LanguageModelUsage;
  }>;
}
```

- [ ] **Step 2: 在 `ensureSession` 初始化时创建 `childAgents` Map**

```typescript
sessionMapRef.current.set(sessionId, {
  messages,
  status: 'idle',
  error: null,
  pendingToolCalls: new Set(),
  pendingApprovals,
  tokenUsage: initialTokenUsage,
  childAgents: new Map(),
});
```

- [ ] **Step 3: 在 `handleEvent` 中新增 `child-agent-update` 分支**

```typescript
case 'child-agent-update': {
  const state = map.get(event.sessionId);
  if (!state) {
    bufferEvent(event);
    return;
  }
  state.childAgents.set(event.childSessionId, {
    childSessionId: event.childSessionId,
    summary: event.summary,
    status: event.status,
    tokenUsage: event.tokenUsage,
  });

  setSessionList((prev) => {
    if (prev.some((s) => s.sessionId === event.childSessionId)) return prev;
    return [
      {
        sessionId: event.childSessionId,
        title: event.summary,
        workspace: event.workspace,
        updatedAt: Date.now(),
        messageCount: 0,
        parentSessionId: event.sessionId,
      } as any,
      ...prev,
    ];
  });

  notifyChange();
  break;
}
```

- [ ] **Step 4: 在 `currentSession` useMemo 中暴露 `childAgents`**

```typescript
return {
  id: currentId,
  messages: state.messages,
  status: state.status,
  error: state.error,
  activity: state.activity,
  pendingApprovals: state.pendingApprovals,
  tokenUsage: state.tokenUsage,
  childAgents: state.childAgents,
};
```

- [ ] **Step 5: 运行类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/use-agents.ts
git commit -m "feat(web): handle child-agent-update in useAgents"
```

---

### Task 10: 创建 `ChildAgentCard` 组件

**Files:**
- Create: `packages/web/src/components/chat/child-agent-card.tsx`

- [ ] **Step 1: 新建文件**

```tsx
'use client';

import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LanguageModelUsage } from 'rem-agent-core';

interface ChildAgentCardProps {
  summary: string;
  status: 'running' | 'completed' | 'failed';
  tokenUsage?: LanguageModelUsage;
  onClick?: () => void;
}

export function ChildAgentCard({ summary, status, tokenUsage, onClick }: ChildAgentCardProps) {
  const isRunning = status === 'running';
  const isFailed = status === 'failed';

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 rounded-card text-xs text-left transition-colors',
        isFailed ? 'bg-err-bg text-err border border-err/30' : 'bg-card border border-bd hover:bg-card/80'
      )}
    >
      {isRunning && <Loader2 size={14} className="animate-spin text-ac" />}
      {!isRunning && (isFailed ? <XCircle size={14} className="text-err" /> : <CheckCircle2 size={14} className="text-ok" />)}
      <span className="flex-1 truncate">{summary}</span>
      {tokenUsage && (
        <span className="text-tx3">{tokenUsage.totalTokens.toLocaleString()} tokens</span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/child-agent-card.tsx
git commit -m "feat(web): add ChildAgentCard component"
```

---

### Task 11: 在 `message-item` 中渲染子 Agent 卡片

**Files:**
- Modify: `packages/web/src/components/chat/message-item.tsx`

- [ ] **Step 1: 引入组件并扩展 props**

```typescript
import { ChildAgentCard } from './child-agent-card';

interface MessageItemProps {
  message: UIMessage;
  childAgents?: Map<string, { childSessionId: string; summary: string; status: 'running' | 'completed' | 'failed'; tokenUsage?: LanguageModelUsage }>;
  onOpenChild?: (sessionId: string) => void;
}
```

- [ ] **Step 2: 在 assistant 消息渲染末尾追加子 Agent 卡片列表**

```tsx
export function MessageItem({ message, childAgents, onOpenChild }: MessageItemProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end py-3">
        <div className="max-w-[60%] rounded-card rounded-br-sm bg-ac text-ac-ink px-4 py-2.5 text-sm leading-relaxed">
          {message.parts.map((part, i) => (part.type === 'text' ? <span key={i}>{part.text}</span> : null))}
        </div>
      </div>
    );
  }

  return (
    <div className="py-3">
      <div className={cn('text-sm leading-relaxed', message.status === 'error' ? 'text-err' : 'text-tx')}>
        {/* existing parts rendering */}
        {childAgents && childAgents.size > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {Array.from(childAgents.values()).map((child) => (
              <ChildAgentCard
                key={child.childSessionId}
                summary={child.summary}
                status={child.status}
                tokenUsage={child.tokenUsage}
                onClick={() => onOpenChild?.(child.childSessionId)}
              />
            ))}
          </div>
        )}
        {message.status === 'error' && message.error && (
          <div className="mt-2 px-3 py-2 rounded-btn bg-err-bg text-err text-xs border border-err/30">{message.error}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 在 `ChatPanel` 中传递 `childAgents` 和 `onOpenChild`**

Modify `packages/web/src/components/chat/chat-panel.tsx`:

```typescript
interface ChatPanelProps {
  // ... existing props
  childAgents?: Map<string, { childSessionId: string; summary: string; status: 'running' | 'completed' | 'failed'; tokenUsage?: LanguageModelUsage }>;
  onOpenChild?: (sessionId: string) => void;
}
```

```tsx
<MessageList messages={messages} childAgents={childAgents} onOpenChild={onOpenChild} />
```

- [ ] **Step 4: 在 `page.tsx` 中实现 `onOpenChild` 切换到子会话**

```typescript
const handleOpenChild = useCallback((sessionId: string) => {
  switchSession(sessionId);
}, [switchSession]);
```

```tsx
<ChatPanel ... childAgents={currentSession?.childAgents} onOpenChild={handleOpenChild} />
```

- [ ] **Step 5: 运行类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/chat/message-item.tsx packages/web/src/components/chat/chat-panel.tsx packages/web/src/app/page.tsx
git commit -m "feat(web): render child agent cards in parent session"
```

---

### Task 12: Web 层 `ChildAgentCard` 组件测试

**Files:**
- Create: `packages/web/src/components/chat/child-agent-card.test.tsx`

- [ ] **Step 1: 新建测试文件**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChildAgentCard } from './child-agent-card';

describe('ChildAgentCard', () => {
  it('renders running status', () => {
    render(<ChildAgentCard summary="running task" status="running" tokenUsage={{ inputTokens: 10, outputTokens: 5, totalTokens: 15 }} />);
    expect(screen.getByText('running task')).toBeDefined();
    expect(screen.getByText('15 tokens')).toBeDefined();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ChildAgentCard summary="done task" status="completed" onClick={onClick} />);
    fireEvent.click(screen.getByText('done task'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test packages/web/src/components/chat/child-agent-card.test.tsx
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/child-agent-card.test.tsx
git commit -m "test(web): add ChildAgentCard tests"
```

---

### Task 13: 全仓类型检查与测试

- [ ] **Step 1: 运行类型检查**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 2: 运行测试**

```bash
pnpm test
```

Expected: 新增测试通过，原有测试无回归

- [ ] **Step 3: Commit（如只产生测试产物）**

```bash
git commit -m "chore: typecheck and tests pass" --allow-empty
```

---

## 自检

- **Spec 覆盖检查：**
  - `delegate_task` 工具：Task 5 ✔
  - 子会话创建与持久化：Task 5 ✔
  - 子上下文继承模型/工具并强制 `auto`：Task 3 ✔
  - 独立预算：Task 3 ✔
  - 递归支持：Task 6 自动注入使子 Agent 也拥有 `delegate_task` ✔
  - 父页面实时状态与 token：Task 9-11 ✔
  - XML 结果注入：Task 4-5 ✔
  - 子会话作为独立 sidebar 条目：Task 9 ✔

- **Placeholder 检查：** 无 TBD、TODO 或"稍后处理"类描述。

- **类型一致性检查：** `child-agent-update` 在 Core、Bridge、Web 三层字段命名一致；`parentSessionId` 在 `SessionSummary` 与 `child-agent-update` 中一致。

---

*计划完成。*
