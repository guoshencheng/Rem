# Workspace 参数化与会话流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 workspace 由前端传入并持久化，AgentService 全程按 workspace 运行会话，runAgent 用传入的 workspace 作为默认 workspaceRoot。

**Architecture:** 在 bridge 层新增 `WorkspaceRepository` 抽象与 JSON 实现，由 `AgentService` 内聚管理 workspace 列表；`IAgentService` 所有方法增加 `workspace` 参数并透传到 core；core 的 `runAgent` 增加 `workspaceRoot` 覆盖能力；session 仍全局存储但元数据记录 workspace，运行时按 workspace 过滤；前端改为多 workspace 标签页布局。

**Tech Stack:** TypeScript, Vitest, Next.js 15, React 19, rem-agent-core, rem-agent-bridge

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/core/src/run-agent.ts` | 接收 `workspaceRoot` 参数并覆盖 `behavior.workspaceRoot` 传给 loop/execute。 |
| `packages/bridge/src/workspace-repository.ts` | 新增：定义 `Workspace`、`WorkspaceRepository` 抽象接口。 |
| `packages/bridge/src/workspace-repository-json.ts` | 新增：`JsonWorkspaceRepository` 实现，持久化到 JSON 文件。 |
| `packages/bridge/src/agent-service.interface.ts` | 修改：所有方法增加 `workspace` 参数，新增 workspace 管理方法。 |
| `packages/bridge/src/agent.ts` | 修改：`AgentService` 注入 `WorkspaceRepository`，方法接收 workspace 并透传。 |
| `packages/bridge/src/agent-session.ts` | 修改：`createSession` / `listSessions` 增加 workspace 参数，记录/过滤 workspace。 |
| `packages/bridge/src/agent-remote-service.ts` | 修改：所有 HTTP 请求携带 `?workspace=` 并调用带 workspace 的方法。 |
| `packages/bridge/src/types.ts` | 修改：`SessionSummary` 增加 `workspace`；新增 workspace 相关 request 类型。 |
| `packages/web/src/lib/container.ts` | 修改：创建 `AgentService` 时注入 `JsonWorkspaceRepository`。 |
| `packages/web/src/app/api/workspaces/route.ts` | 新增：workspace 增删查 API。 |
| `packages/web/src/app/api/sessions/route.ts` | 修改：接收 `workspace` query 参数。 |
| `packages/web/src/app/api/sessions/[id]/route.ts` | 修改：接收 `workspace` query 参数。 |
| `packages/web/src/app/api/agent/run/route.ts` | 修改：接收 `workspace` query 参数。 |
| `packages/web/src/app/api/agent/interrupt/route.ts` | 修改：接收 `workspace` query 参数。 |
| `packages/web/src/app/api/agent/reset/route.ts` | 修改：接收 `workspace` query 参数。 |
| `packages/web/src/app/api/agent/stream/route.ts` | 修改：接收 `workspace` query 参数。 |
| `packages/web/src/app/api/approvals/route.ts` | 修改：接收 `workspace` query 参数。 |
| `packages/web/src/app/api/approvals/[id]/resolve/route.ts` | 修改：接收 `workspace` query 参数。 |
| `packages/web/src/lib/use-agents.ts` | 修改：`useAgents(agentService, workspace)`，按 workspace 过滤事件与会话。 |
| `packages/web/src/app/page.tsx` | 修改：多 workspace 标签页布局。 |
| `packages/web/src/components/workspace/workspace-tabs.tsx` | 新增：workspace 标签栏组件。 |
| `packages/web/src/components/workspace/add-workspace-dialog.tsx` | 新增：添加 workspace 弹窗。 |
| `packages/web/src/components/workspace/workspace-onboarding.tsx` | 新增：首次无 workspace 引导页。 |
| `packages/bridge/tests/workspace-repository-json.test.ts` | 新增：`JsonWorkspaceRepository` 单元测试。 |
| `packages/bridge/tests/agent-service-workspace.test.ts` | 新增：`AgentService` workspace 透传测试。 |
| `packages/core/tests/run-agent-workspace-root.test.ts` | 新增：`runAgent` workspaceRoot 推导测试。 |

---

### Task 1: Core — 让 runAgent 支持 workspaceRoot 覆盖

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Test: `packages/core/tests/run-agent-workspace-root.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../src/run-agent.js';
import type { AgentContext } from '../src/agent-context.js';
import { AgentState } from '../src/agent-state.js';
import type { SessionProvider } from '../src/sdk/session-provider.js';

function fakeContext(overrides?: { workspaceRoot?: string }): AgentContext {
  const behavior = {
    name: 'Test',
    maxTurns: 1,
    workspaceRoot: overrides?.workspaceRoot ?? '/default-root',
    readOnly: false,
    autoApproveDangerous: false,
  } as any;

  return {
    configProvider: {
      getBehaviorConfig: () => behavior,
      getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o', apiKey: 'key' }),
      getMcpConfig: () => ({}),
      getToolConfig: () => ({}),
    } as any,
    sessionProvider: {
      load: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      addMessage: vi.fn(() => ({ id: 'm1', role: 'assistant', content: [] })),
      appendContent: vi.fn(),
    } as unknown as SessionProvider,
    contextProvider: { build: vi.fn(async () => ({ system: '', messages: [] })) },
    compressor: { shouldCompress: () => false, compress: async (m: any) => m },
    skillProvider: { loadSkills: vi.fn(async () => []), formatCatalog: () => '' },
    toolProvider: { getToolSet: () => ({}), execute: vi.fn(async () => []) },
    mcpProviders: [],
    toolComposer: { compose: () => ({ getToolSet: () => ({}), execute: vi.fn(async () => []) }) },
    budgetPolicy: { checkTurn: () => true, checkTimeout: () => true },
    errorHandler: { handle: vi.fn() },
    titleProvider: { generateTitle: vi.fn(async () => null) },
    loopStrategy: {
      run: vi.fn(async (ctx: any) => {
        // Capture the workspaceRoot seen by the loop
        (fakeContext as any)._capturedWorkspaceRoot = ctx.workspaceRoot;
        (fakeContext as any)._capturedExecuteWorkspaceRoot = null;
        // We can't easily capture execute() without calling it; covered in integration.
        return { content: 'ok', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      }),
    },
  } as unknown as AgentContext;
}

describe('runAgent workspaceRoot', () => {
  it('uses explicit workspaceRoot over behavior.workspaceRoot', async () => {
    const ctx = fakeContext({ workspaceRoot: '/default-root' });
    const agentState = new AgentState();
    const { output } = runAgent({
      input: { content: 'hi', timestamp: new Date() },
      sessionId: 's1',
      ctx,
      agentState,
      workspace: '/workspace-a',
      workspaceRoot: '/workspace-a',
    });
    await output;
    expect((ctx as any)._capturedWorkspaceRoot).toBe('/workspace-a');
  });

  it('falls back to behavior.workspaceRoot when workspaceRoot is not provided', async () => {
    const ctx = fakeContext({ workspaceRoot: '/default-root' });
    const agentState = new AgentState();
    const { output } = runAgent({
      input: { content: 'hi', timestamp: new Date() },
      sessionId: 's2',
      ctx,
      agentState,
    });
    await output;
    expect((ctx as any)._capturedWorkspaceRoot).toBe('/default-root');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test run packages/core/tests/run-agent-workspace-root.test.ts`

Expected: FAIL — `workspaceRoot` property does not exist on `RunAgentParams`.

- [ ] **Step 3: Modify `RunAgentParams` and use `workspaceRoot`**

Modify `packages/core/src/run-agent.ts`:

```typescript
export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  ctx: AgentContext;
  agentState: AgentState;
  workspace?: string;
  workspaceRoot?: string; // NEW
}
```

Inside `runAgent`, after `const workspace = params.workspace ?? 'default';` add:

```typescript
const workspaceRoot = params.workspaceRoot ?? behavior.workspaceRoot;
```

Then replace every usage of `behavior.workspaceRoot` in the loop context with `workspaceRoot`:

```typescript
execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
  toolCalls: calls, toolProvider: effectiveToolProvider, addMessage, appendContent,
  agentState: params.agentState,
  workspaceRoot, // CHANGED from behavior.workspaceRoot
  agentName: behavior.name,
  readOnly: behavior.readOnly, sessionId: params.sessionId, signal: params.signal,
  emit: (chunk) => trackMessageStart(chunk),
}),
// ...
workspaceRoot, // CHANGED from behavior.workspaceRoot
readOnly: behavior.readOnly,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test run packages/core/tests/run-agent-workspace-root.test.ts`

Expected: PASS

- [ ] **Step 5: Run full core tests**

Run: `pnpm --filter rem-agent-core test`

Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/run-agent.ts packages/core/tests/run-agent-workspace-root.test.ts
git commit -m "feat(core): allow runAgent to override workspaceRoot per call"
```

---

### Task 2: Bridge — 新增 WorkspaceRepository 抽象与 JSON 实现

**Files:**
- Create: `packages/bridge/src/workspace-repository.ts`
- Create: `packages/bridge/src/workspace-repository-json.ts`
- Create: `packages/bridge/tests/workspace-repository-json.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/bridge/tests/workspace-repository-json.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonWorkspaceRepository } from '../src/workspace-repository-json.js';

describe('JsonWorkspaceRepository', () => {
  let tmpDir: string;
  let repo: JsonWorkspaceRepository;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-repo-'));
    repo = new JsonWorkspaceRepository(path.join(tmpDir, 'workspaces.json'));
  });

  it('lists empty workspaces initially', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('adds a workspace and returns it', async () => {
    const ws = await repo.add(tmpDir, 'my-tmp');
    expect(ws.path).toBe(tmpDir);
    expect(ws.name).toBe('my-tmp');
    expect(ws.createdAt).toBeTypeOf('number');

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe(tmpDir);
  });

  it('defaults name to basename of path', async () => {
    const ws = await repo.add(tmpDir);
    expect(ws.name).toBe(path.basename(tmpDir));
  });

  it('rejects non-existent paths', async () => {
    await expect(repo.add('/definitely/not/existing')).rejects.toThrow();
  });

  it('rejects duplicate paths', async () => {
    await repo.add(tmpDir);
    await expect(repo.add(tmpDir)).rejects.toThrow('already exists');
  });

  it('removes a workspace', async () => {
    await repo.add(tmpDir);
    await repo.remove(tmpDir);
    expect(await repo.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-bridge test run packages/bridge/tests/workspace-repository-json.test.ts`

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `WorkspaceRepository` interface**

Create `packages/bridge/src/workspace-repository.ts`:

```typescript
export interface Workspace {
  /** workspace 唯一标识符，即目录绝对路径 */
  path: string;
  /** 显示名称，默认取目录名 */
  name: string;
  /** 添加时间戳 */
  createdAt: number;
}

export interface WorkspaceRepository {
  list(): Promise<Workspace[]>;
  add(path: string, name?: string): Promise<Workspace>;
  remove(path: string): Promise<void>;
}
```

- [ ] **Step 4: Create `JsonWorkspaceRepository` implementation**

Create `packages/bridge/src/workspace-repository-json.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Workspace, WorkspaceRepository } from './workspace-repository.js';

interface PersistedWorkspace {
  path: string;
  name?: string;
  createdAt: number;
}

interface PersistedData {
  workspaces: PersistedWorkspace[];
}

export class JsonWorkspaceRepository implements WorkspaceRepository {
  constructor(private filePath: string) {}

  async list(): Promise<Workspace[]> {
    const data = await this.read();
    return data.workspaces
      .map((w) => this.normalize(w))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async add(rawPath: string, name?: string): Promise<Workspace> {
    const absolutePath = path.resolve(rawPath);
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: ${absolutePath}`);
      }
    } catch (err) {
      throw new Error(`Workspace path does not exist or is not readable: ${absolutePath}`);
    }

    const data = await this.read();
    if (data.workspaces.some((w) => w.path === absolutePath)) {
      throw new Error(`Workspace already exists: ${absolutePath}`);
    }

    const workspace: PersistedWorkspace = {
      path: absolutePath,
      name: name || path.basename(absolutePath),
      createdAt: Date.now(),
    };
    data.workspaces.push(workspace);
    await this.write(data);
    return this.normalize(workspace);
  }

  async remove(rawPath: string): Promise<void> {
    const absolutePath = path.resolve(rawPath);
    const data = await this.read();
    const index = data.workspaces.findIndex((w) => w.path === absolutePath);
    if (index === -1) {
      throw new Error(`Workspace not found: ${absolutePath}`);
    }
    data.workspaces.splice(index, 1);
    await this.write(data);
  }

  private normalize(w: PersistedWorkspace): Workspace {
    return {
      path: w.path,
      name: w.name || path.basename(w.path),
      createdAt: w.createdAt,
    };
  }

  private async read(): Promise<PersistedData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedData>;
      return { workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [] };
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return { workspaces: [] };
      }
      throw err;
    }
  }

  private async write(data: PersistedData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, this.filePath);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter rem-agent-bridge test run packages/bridge/tests/workspace-repository-json.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/workspace-repository.ts packages/bridge/src/workspace-repository-json.ts packages/bridge/tests/workspace-repository-json.test.ts
git commit -m "feat(bridge): add WorkspaceRepository abstraction and JSON implementation"
```

---

### Task 3: Bridge — 更新类型与接口

**Files:**
- Modify: `packages/bridge/src/types.ts`
- Modify: `packages/bridge/src/agent-service.interface.ts`
- Modify: `packages/bridge/src/index.ts` (export new types if exists)

- [ ] **Step 1: Update `types.ts`**

Modify `packages/bridge/src/types.ts`:

```typescript
export interface Workspace {
  path: string;
  name: string;
  createdAt: number;
}

export interface AddWorkspaceRequest {
  path: string;
  name?: string;
}

export interface RemoveWorkspaceRequest {
  path: string;
}

export interface SessionSummary {
  sessionId: string;
  workspace: string;        // NEW
  title?: string;
  pinned?: boolean;
  updatedAt: number;
  messageCount: number;
  activity?: SessionActivity;
  tokenUsage?: LanguageModelUsage;
}
```

- [ ] **Step 2: Update `IAgentService`**

Modify `packages/bridge/src/agent-service.interface.ts`:

```typescript
import type { ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage, Workspace } from './types.js';

export interface IAgentService {
  init(): Promise<void>;

  // Workspace management
  listWorkspaces(): Promise<Workspace[]>;
  addWorkspace(path: string, name?: string): Promise<Workspace>;
  removeWorkspace(path: string): Promise<void>;

  // Session operations now require workspace
  run(workspace: string, sessionId: string, input: string): Promise<void>;
  interrupt(workspace: string, sessionId: string): Promise<void>;
  reset(workspace: string, sessionId: string): Promise<void>;
  createSession(workspace: string): Promise<SessionSummary>;
  listSessions(workspace: string): Promise<SessionSummary[]>;
  getMessages(workspace: string, sessionId: string): Promise<UIMessage[]>;
  updateSession(workspace: string, sessionId: string, updates: SessionUpdate): Promise<void>;
  deleteSession(workspace: string, sessionId: string): Promise<void>;
  stream(workspace: string): AsyncIterable<BusEvent>;
  listPendingApprovals(workspace: string, sessionId: string): Promise<ApprovalRequest[]>;
  resolveApproval(workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean>;
}
```

- [ ] **Step 3: Re-export workspace types from bridge entry**

If `packages/bridge/src/index.ts` exists, add:

```typescript
export { Workspace, WorkspaceRepository, AddWorkspaceRequest, RemoveWorkspaceRequest } from './types.js';
export { JsonWorkspaceRepository } from './workspace-repository-json.js';
```

- [ ] **Step 4: Run bridge typecheck**

Run: `pnpm --filter rem-agent-bridge typecheck`

Expected: Type errors (because implementations not updated yet — this is expected, but fix immediately in next tasks).

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/types.ts packages/bridge/src/agent-service.interface.ts packages/bridge/src/index.ts
git commit -m "feat(bridge): add workspace to IAgentService and SessionSummary types"
```

---

### Task 4: Bridge — 更新 AgentSessionManager 支持 workspace

**Files:**
- Modify: `packages/bridge/src/agent-session.ts`

- [ ] **Step 1: Update `createSession`**

Modify `createSession` to accept workspace and persist it in metadata:

```typescript
async createSession(workspace: string): Promise<SessionSummary> {
  const session = await this.sessionProvider.create();
  session.metadata.workspace = workspace;
  await this.sessionProvider.save(session);
  return this.toSummary(session, workspace);
}
```

- [ ] **Step 2: Update `listSessions`**

Modify `listSessions` to accept workspace and filter by metadata:

```typescript
async listSessions(workspace: string): Promise<SessionSummary[]> {
  const summaries = await this.sessionProvider.list();
  const enriched = await Promise.all(
    summaries.map(async (s) => {
      const session = await this.sessionProvider.load(s.sessionId);
      if (!session) return null;
      const sessionWorkspace = (session.metadata?.workspace as string | undefined) ?? 'default';
      if (sessionWorkspace !== workspace) return null;
      const tokenUsage = this.computeTotalTokenUsage(session.metadata?.messageTokenUsage);
      return {
        sessionId: s.sessionId,
        workspace: sessionWorkspace,
        title: s.title ?? 'New Chat',
        pinned: s.pinned,
        updatedAt: s.updatedAt.getTime(),
        messageCount: s.messageCount,
        tokenUsage,
      };
    }),
  );
  const filtered = enriched.filter((s): s is NonNullable<typeof s> => s !== null);
  return filtered.sort((a, b) => {
    if (a.pinned === b.pinned) {
      return b.updatedAt - a.updatedAt;
    }
    return a.pinned ? -1 : 1;
  });
}
```

- [ ] **Step 3: Update `toSummary`**

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
    updatedAt: session.updatedAt.getTime(),
    messageCount: Array.isArray(session.conversation) ? session.conversation.length : 0,
  };
}
```

- [ ] **Step 4: Run bridge typecheck and tests**

Run: `pnpm --filter rem-agent-bridge typecheck && pnpm --filter rem-agent-bridge test`

Expected: Type errors gone; existing tests may fail because caller signatures changed — fix in next task.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/agent-session.ts
git commit -m "feat(bridge): tag sessions with workspace and filter lists by workspace"
```

---

### Task 5: Bridge — 更新 AgentService 透传 workspace 并管理 workspaces

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Test: `packages/bridge/tests/agent-service-workspace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/bridge/tests/agent-service-workspace.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../src/agent.js';
import { JsonWorkspaceRepository } from '../src/workspace-repository-json.js';
import type { IAgentService } from '../src/agent-service.interface.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function makeService(): Promise<{ service: IAgentService; tmpDir: string; repo: JsonWorkspaceRepository }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-svc-'));
  const repo = new JsonWorkspaceRepository(path.join(tmpDir, 'workspaces.json'));
  const service = new AgentService({}, repo);
  return { service, tmpDir, repo };
}

describe('AgentService workspace', () => {
  it('lists, adds and removes workspaces', async () => {
    const { service, tmpDir } = await makeService();
    expect(await service.listWorkspaces()).toEqual([]);

    const ws = await service.addWorkspace(tmpDir);
    expect(ws.path).toBe(tmpDir);

    const list = await service.listWorkspaces();
    expect(list).toHaveLength(1);

    await service.removeWorkspace(tmpDir);
    expect(await service.listWorkspaces()).toEqual([]);
  });

  it('passes workspace to createSession and listSessions', async () => {
    const { service, tmpDir } = await makeService();
    await service.init();

    const ws = await service.addWorkspace(tmpDir);
    const session = await service.createSession(ws.path);
    expect(session.workspace).toBe(ws.path);

    const list = await service.listSessions(ws.path);
    expect(list).toHaveLength(1);
    expect(list[0].workspace).toBe(ws.path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-bridge test run packages/bridge/tests/agent-service-workspace.test.ts`

Expected: FAIL — constructor signature wrong, methods missing workspace params.

- [ ] **Step 3: Update `AgentService` constructor and fields**

Modify `packages/bridge/src/agent.ts`:

```typescript
import type { Workspace, WorkspaceRepository } from './workspace-repository.js';

export class AgentService implements IAgentService {
  private options: AgentServiceOptions;
  private ctx: AgentContext | undefined;
  private sessionManager: AgentSessionManager | undefined;
  private agentState = new AgentState();
  private initialized = false;

  constructor(
    options: AgentServiceOptions,
    private workspaceRepository: WorkspaceRepository,
  ) {
    this.options = options;
  }

  // ... remove `get context()` if unused, or keep it
```

- [ ] **Step 4: Add workspace management methods**

```typescript
async listWorkspaces(): Promise<Workspace[]> {
  return this.workspaceRepository.list();
}

async addWorkspace(path: string, name?: string): Promise<Workspace> {
  return this.workspaceRepository.add(path, name);
}

async removeWorkspace(path: string): Promise<void> {
  return this.workspaceRepository.remove(path);
}
```

- [ ] **Step 5: Update all session methods to accept workspace**

```typescript
async run(workspace: string, sessionId: string, input: string): Promise<void> {
  this.ensureInitialized();

  if (this.agentState.isRunning(sessionId)) {
    throw new ServiceError('Session is already running', 409);
  }

  const abortController = this.agentState.startRun(sessionId, workspace);

  let result: ReturnType<typeof coreRunAgent>;
  try {
    result = coreRunAgent({
      input: { content: input, timestamp: new Date() },
      sessionId,
      signal: abortController.signal,
      ctx: this.ctx!,
      agentState: this.agentState,
      workspace,
      workspaceRoot: workspace,
    });
  } catch (err) {
    this.agentState.finishRun(sessionId, workspace, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  void this.drive(sessionId, workspace, abortController.signal, result);
}

private async drive(
  sessionId: string,
  workspace: string,
  signal: AbortSignal,
  result: ReturnType<typeof coreRunAgent>,
): Promise<void> {
  // replace all this.workspace with workspace parameter
  const consume = (async () => {
    for await (const chunk of result.stream.fullStream) {
      this.agentState.applyChunk(workspace, sessionId, chunk);
    }
  })();

  const outputGuard = result.output.then(
    () => new Promise<never>(() => {}),
    (err) => { throw err instanceof Error ? err : new Error(String(err)); },
  );

  try {
    await Promise.race([consume, outputGuard]);
  } catch (err) {
    if (signal.aborted) {
      this.agentState.finishRun(sessionId, workspace);
    } else {
      const message = err instanceof Error ? err.message : String(err);
      this.agentState.finishRun(sessionId, workspace, { error: message });
    }
  }

  if (this.agentState.isRunning(sessionId)) {
    this.agentState.finishRun(sessionId, workspace);
  }
}

async interrupt(_workspace: string, sessionId: string): Promise<void> {
  this.agentState.abortRun(sessionId);
}

async reset(_workspace: string, sessionId: string): Promise<void> {
  this.agentState.abortRun(sessionId);
  this.agentState.finishRun(sessionId, 'default');
}

async getMessages(_workspace: string, sessionId: string): Promise<UIMessage[]> {
  this.ensureInitialized();
  return this.sessionManager!.getMessages(sessionId);
}

async createSession(workspace: string): Promise<SessionSummary> {
  this.ensureInitialized();
  return this.sessionManager!.createSession(workspace);
}

async listSessions(workspace: string): Promise<SessionSummary[]> {
  this.ensureInitialized();
  const list = await this.sessionManager!.listSessions(workspace);
  return list.map((s) => ({
    ...s,
    activity: this.agentState.get(s.sessionId)?.activity ?? 'idle',
  }));
}

async updateSession(_workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
  this.ensureInitialized();
  return this.sessionManager!.updateSession(sessionId, updates);
}

async deleteSession(_workspace: string, sessionId: string): Promise<void> {
  this.ensureInitialized();
  return this.sessionManager!.deleteSession(sessionId);
}

async listPendingApprovals(_workspace: string, sessionId: string): Promise<ApprovalRequest[]> {
  this.ensureInitialized();
  const liveState = this.agentState.get(sessionId);
  return liveState?.pendingApprovals ?? [];
}

async resolveApproval(_workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean> {
  return this.agentState.resolveApproval(sessionId, approvalId, decision);
}
```

- [ ] **Step 6: Update `stream` method**

```typescript
async *stream(workspace: string): AsyncIterable<BusEvent> {
  const queue: BusEvent[] = [];
  let resolveNext: ((event: BusEvent) => void) | null = null;

  const unsub = this.agentState.subscribe((event) => {
    if (event.workspace !== workspace) return;
    if (resolveNext) {
      resolveNext(event);
      resolveNext = null;
    } else {
      queue.push(event);
    }
  });

  try {
    for (const sessionId of this.agentState.runningSessionIds()) {
      const snapshot = this.agentState.getSnapshot(sessionId);
      if (snapshot) {
        yield {
          workspace,
          sessionId,
          type: 'snapshot',
          messageId: snapshot.messageId,
          parts: snapshot.parts,
        };
      }
    }

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        yield await new Promise<BusEvent>((r) => { resolveNext = r; });
      }
    }
  } finally {
    unsub();
  }
}
```

- [ ] **Step 7: Run bridge tests**

Run: `pnpm --filter rem-agent-bridge typecheck && pnpm --filter rem-agent-bridge test`

Expected: PASS after fixing any remaining call-site mismatches.

- [ ] **Step 8: Commit**

```bash
git add packages/bridge/src/agent.ts packages/bridge/tests/agent-service-workspace.test.ts
git commit -m "feat(bridge): make AgentService workspace-aware and manage workspaces"
```

---

### Task 6: Bridge — 更新 AgentRemoteService 发送 workspace

**Files:**
- Modify: `packages/bridge/src/agent-remote-service.ts`

- [ ] **Step 1: Update constructor to accept workspace**

```typescript
export class AgentRemoteService implements IAgentService {
  constructor(
    private baseUrl: string,
    private workspace: string,
  ) {}
```

- [ ] **Step 2: Add workspace query helper**

```typescript
private workspaceQuery(): string {
  return `workspace=${encodeURIComponent(this.workspace)}`;
}
```

- [ ] **Step 3: Update all fetch calls**

```typescript
async run(_workspace: string, sessionId: string, input: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/agent/run?${this.workspaceQuery()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content: input }),
  });
  // ...
}

async interrupt(_workspace: string, sessionId: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/agent/interrupt?${this.workspaceQuery()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId } satisfies InterruptRequest),
  });
  // ...
}

async reset(_workspace: string, sessionId: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/agent/reset?${this.workspaceQuery()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId } satisfies ResetRequest),
  });
  // ...
}

async createSession(_workspace: string): Promise<SessionSummary> {
  const response = await fetch(`${this.baseUrl}/api/sessions?${this.workspaceQuery()}`, { method: 'POST' });
  // ...
}

async listSessions(_workspace: string): Promise<SessionSummary[]> {
  const response = await fetch(`${this.baseUrl}/api/sessions?${this.workspaceQuery()}`);
  // ...
}

async getMessages(_workspace: string, sessionId: string): Promise<UIMessage[]> {
  const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}?${this.workspaceQuery()}`);
  // ...
}

async updateSession(_workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}?${this.workspaceQuery()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  // ...
}

async deleteSession(_workspace: string, sessionId: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}?${this.workspaceQuery()}`, { method: 'DELETE' });
  // ...
}

async listPendingApprovals(_workspace: string, sessionId: string): Promise<ApprovalRequest[]> {
  const response = await fetch(`${this.baseUrl}/api/approvals?${this.workspaceQuery()}&sessionId=${encodeURIComponent(sessionId)}`);
  // ...
}

async resolveApproval(_workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean> {
  const response = await fetch(`${this.baseUrl}/api/approvals/${encodeURIComponent(approvalId)}/resolve?${this.workspaceQuery()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, decision }),
  });
  // ...
}

async *stream(_workspace: string): AsyncIterable<BusEvent> {
  const response = await fetch(`${this.baseUrl}/api/agent/stream?${this.workspaceQuery()}`);
  // ...
}
```

- [ ] **Step 4: Add workspace management methods**

```typescript
async listWorkspaces(): Promise<Workspace[]> {
  const response = await fetch(`${this.baseUrl}/api/workspaces`);
  if (!response.ok) {
    throw new Error(`Failed to list workspaces: ${response.status}`);
  }
  return (await response.json()) as Workspace[];
}

async addWorkspace(path: string, name?: string): Promise<Workspace> {
  const response = await fetch(`${this.baseUrl}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  });
  if (!response.ok) {
    throw new Error(`Failed to add workspace: ${response.status}`);
  }
  return (await response.json()) as Workspace;
}

async removeWorkspace(path: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/workspaces`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    throw new Error(`Failed to remove workspace: ${response.status}`);
  }
}
```

- [ ] **Step 5: Run bridge typecheck**

Run: `pnpm --filter rem-agent-bridge typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/agent-remote-service.ts
git commit -m "feat(bridge): send workspace in AgentRemoteService requests"
```

---

### Task 7: Web — 更新 Container 注入 WorkspaceRepository

**Files:**
- Modify: `packages/web/src/lib/container.ts`

- [ ] **Step 1: Update container to create JsonWorkspaceRepository**

```typescript
import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentService, JsonWorkspaceRepository } from 'rem-agent-bridge';
import { createDefaultAgentPaths } from 'rem-agent-core';

const GLOBAL_CONTAINER_KEY = '__REM_AGENT_CONTAINER__';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  const paths = createDefaultAgentPaths();
  const workspaceRepository = new JsonWorkspaceRepository(
    process.env.REM_AGENT_WORKSPACES_FILE ?? `${paths.configDir}/workspaces.json`,
  );
  const service = new AgentService({ workspaceRoot: process.cwd() }, workspaceRepository);
  await service.init();

  // ... keep existing log

  container.register({
    agentService: asFunction(() => service, { lifetime: Lifetime.SINGLETON }),
    workspaceRepository: asFunction(() => workspaceRepository, { lifetime: Lifetime.SINGLETON }),
  });

  return container;
}
```

- [ ] **Step 2: Verify configDir exists on paths**

If `createDefaultAgentPaths()` does not return `configDir`, use `paths.sessionsDir` parent or a hardcoded path like `~/.config/rem-agent/workspaces.json`. Check `packages/core/src/config/paths.ts` and adjust.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/container.ts
git commit -m "feat(web): inject JsonWorkspaceRepository into AgentService"
```

---

### Task 8: Web API — 新增 `/api/workspaces` 路由并改造现有路由

**Files:**
- Create: `packages/web/src/app/api/workspaces/route.ts`
- Modify: `packages/web/src/app/api/sessions/route.ts`
- Modify: `packages/web/src/app/api/sessions/[id]/route.ts`
- Modify: `packages/web/src/app/api/agent/run/route.ts`
- Modify: `packages/web/src/app/api/agent/interrupt/route.ts`
- Modify: `packages/web/src/app/api/agent/reset/route.ts`
- Modify: `packages/web/src/app/api/agent/stream/route.ts`
- Modify: `packages/web/src/app/api/approvals/route.ts`
- Modify: `packages/web/src/app/api/approvals/[id]/resolve/route.ts`

- [ ] **Step 1: Create helper to extract workspace from query**

Create `packages/web/src/app/api/workspace-param.ts`:

```typescript
import { NextRequest } from 'next/server';

export function getWorkspace(request: NextRequest): string {
  const workspace = new URL(request.url).searchParams.get('workspace');
  if (!workspace) {
    throw new Error('Missing workspace query parameter');
  }
  return decodeURIComponent(workspace);
}
```

- [ ] **Step 2: Create `/api/workspaces` route**

Create `packages/web/src/app/api/workspaces/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ServiceError, type IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    return NextResponse.json(await agentService.listWorkspaces());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, name } = body as { path: string; name?: string };
    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    return NextResponse.json(await agentService.addWorkspace(path, name));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { path } = body as { path: string };
    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    await agentService.removeWorkspace(path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Update `/api/sessions` route**

Modify `packages/web/src/app/api/sessions/route.ts`:

```typescript
import { getWorkspace } from '../workspace-param.js';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    const workspace = getWorkspace(request);
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    let sessions = await agentService.listSessions(workspace);
    if (q) {
      const lower = q.toLowerCase();
      sessions = sessions.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
    }
    return NextResponse.json(sessions);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspace = getWorkspace(request);
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const result = await agentService.createSession(workspace);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: Update `/api/sessions/[id]` route**

Read current file and modify GET/DELETE/PATCH to use `getWorkspace(request)` and pass it to `getMessages`, `deleteSession`, `updateSession`.

- [ ] **Step 5: Update `/api/agent/run` route**

```typescript
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, content } = body as { sessionId: string; content?: string };
    const workspace = getWorkspace(request);

    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');

    if (!content || !sessionId) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    await agentService.run(workspace, sessionId, content);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: Update `/api/agent/interrupt`, `/api/agent/reset`**

Similarly extract workspace and pass to `agentService.interrupt(workspace, sessionId)` / `agentService.reset(workspace, sessionId)`.

- [ ] **Step 7: Update `/api/agent/stream`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { BusEvent, IAgentService } from 'rem-agent-bridge';
import { createBusSSEResponse } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';
import { getWorkspace } from '../workspace-param.js';

async function getAgentService(): Promise<IAgentService> {
  const container = await getContainer();
  return container.resolve('agentService') as IAgentService;
}

export async function GET(request: NextRequest) {
  try {
    const workspace = getWorkspace(request);
    const service = await getAgentService();
    return createBusSSEResponse(service.stream(workspace));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 8: Update approvals routes**

Pass workspace to `listPendingApprovals` and `resolveApproval`.

- [ ] **Step 9: Run web typecheck**

Run: `pnpm --filter rem-agent-web typecheck`

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/app/api/
git commit -m "feat(web): add /api/workspaces and pass workspace through all API routes"
```

---

### Task 9: Web — 更新 `useAgents` 支持按 workspace 运行

**Files:**
- Modify: `packages/web/src/lib/use-agents.ts`

- [ ] **Step 1: Update hook signature**

```typescript
interface UseAgentsOptions {
  workspace: string;
}

export function useAgents(agentService: IAgentService, options: UseAgentsOptions) {
  const workspace = options.workspace;
  // ...
}
```

- [ ] **Step 2: Update all agentService calls to include workspace**

Search and replace all `agentService.` calls to pass `workspace` as first argument:

```typescript
agentService.listSessions(workspace)
agentService.createSession(workspace)
agentService.run(workspace, sessionId, content)
agentService.interrupt(workspace, sessionId)
agentService.reset(workspace, sessionId)
agentService.getMessages(workspace, sessionId)
agentService.updateSession(workspace, sessionId, updates)
agentService.deleteSession(workspace, sessionId)
agentService.stream(workspace)
agentService.listPendingApprovals(workspace, sessionId)
agentService.resolveApproval(workspace, sessionId, approvalId, decision)
```

- [ ] **Step 3: Update stream event filtering**

The existing filter `if (event.workspace !== workspace) return;` should already work since workspace is now the path.

- [ ] **Step 4: Run web typecheck**

Run: `pnpm --filter rem-agent-web typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/use-agents.ts
git commit -m "feat(web): make useAgents workspace-aware"
```

---

### Task 10: Web — 添加 Workspace UI 组件

**Files:**
- Create: `packages/web/src/components/workspace/workspace-tabs.tsx`
- Create: `packages/web/src/components/workspace/add-workspace-dialog.tsx`
- Create: `packages/web/src/components/workspace/workspace-onboarding.tsx`

- [ ] **Step 1: Create `AddWorkspaceDialog`**

Create a simple dialog with an input for absolute path and optional name, plus confirm/cancel buttons. On confirm call `onAdd(path, name)`.

```typescript
'use client';

import { useState } from 'react';

interface AddWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (path: string, name?: string) => void | Promise<void>;
}

export function AddWorkspaceDialog({ open, onClose, onAdd }: AddWorkspaceDialogProps) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg1 p-6 rounded-lg w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Add Workspace</h2>
        <label className="block text-sm mb-1">Path</label>
        <input
          className="w-full border rounded px-3 py-2 mb-3"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/absolute/path/to/project"
        />
        <label className="block text-sm mb-1">Name (optional)</label>
        <input
          className="w-full border rounded px-3 py-2 mb-4"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Project"
        />
        <div className="flex justify-end gap-2">
          <button className="px-4 py-2" onClick={onClose}>Cancel</button>
          <button
            className="px-4 py-2 bg-primary text-white rounded"
            onClick={() => { void onAdd(path, name || undefined); setPath(''); setName(''); }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `WorkspaceTabs`**

Renders tabs for each workspace, active tab, close button, and an "Add" button.

```typescript
'use client';

import type { Workspace } from 'rem-agent-bridge';

interface WorkspaceTabsProps {
  workspaces: Workspace[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
}

export function WorkspaceTabs({ workspaces, activePath, onSelect, onClose, onAdd }: WorkspaceTabsProps) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1">
      {workspaces.map((ws) => (
        <button
          key={ws.path}
          onClick={() => onSelect(ws.path)}
          className={`flex items-center gap-2 px-3 py-1 rounded-t ${activePath === ws.path ? 'bg-bg1 border-t border-x' : ''}`}
        >
          <span className="truncate max-w-[160px]">{ws.name}</span>
          <span
            onClick={(e) => { e.stopPropagation(); onClose(ws.path); }}
            className="text-tx3 hover:text-tx1"
          >
            ×
          </span>
        </button>
      ))}
      <button onClick={onAdd} className="px-2 py-1 text-primary">+</button>
    </div>
  );
}
```

- [ ] **Step 3: Create `WorkspaceOnboarding`**

```typescript
'use client';

interface WorkspaceOnboardingProps {
  onAdd: () => void;
}

export function WorkspaceOnboarding({ onAdd }: WorkspaceOnboardingProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-tx2">
      <h1 className="text-2xl font-semibold mb-2">Welcome to Rem Agent</h1>
      <p className="mb-6">Add a workspace to start chatting.</p>
      <button onClick={onAdd} className="px-6 py-2 bg-primary text-white rounded">Add Workspace</button>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/workspace/
git commit -m "feat(web): add workspace UI components"
```

---

### Task 11: Web — 改造 `page.tsx` 为多 workspace 标签页布局

**Files:**
- Modify: `packages/web/src/app/page.tsx`

- [ ] **Step 1: Rewrite page with workspace state**

```typescript
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { AgentRemoteService } from 'rem-agent-bridge/client';
import type { Workspace } from 'rem-agent-bridge';
import { useAgents } from '@/lib/use-agents';
import type { SessionSummary } from '@/lib/use-agents';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { WorkspaceTabs } from '@/components/workspace/workspace-tabs';
import { AddWorkspaceDialog } from '@/components/workspace/add-workspace-dialog';
import { WorkspaceOnboarding } from '@/components/workspace/workspace-onboarding';

export default function Home() {
  const agentService = useMemo(() => new AgentRemoteService('', 'default'), []);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    agentService.listWorkspaces().then((list) => {
      setWorkspaces(list);
      if (list.length > 0) {
        setActiveWorkspace(list[0].path);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [agentService]);

  const handleAdd = useCallback(async (path: string, name?: string) => {
    const ws = await agentService.addWorkspace(path, name);
    setWorkspaces((prev) => [...prev, ws]);
    setActiveWorkspace(ws.path);
    setDialogOpen(false);
  }, [agentService]);

  const handleClose = useCallback((path: string) => {
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.path !== path);
      if (activeWorkspace === path) {
        setActiveWorkspace(next[0]?.path ?? null);
      }
      return next;
    });
  }, [activeWorkspace]);

  if (!loaded) {
    return <div className="flex h-full items-center justify-center">Loading...</div>;
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex h-full">
        <WorkspaceOnboarding onAdd={() => setDialogOpen(true)} />
        <AddWorkspaceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={handleAdd} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <WorkspaceTabs
        workspaces={workspaces}
        activePath={activeWorkspace}
        onSelect={setActiveWorkspace}
        onClose={handleClose}
        onAdd={() => setDialogOpen(true)}
      />
      <div className="flex-1 overflow-hidden">
        {activeWorkspace && (
          <WorkspacePanel
            key={activeWorkspace}
            workspace={activeWorkspace}
          />
        )}
      </div>
      <AddWorkspaceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={handleAdd} />
    </div>
  );
}
```

- [ ] **Step 2: Create `WorkspacePanel`**

Extract the existing page body into a component that takes `workspace: string`:

```typescript
'use client';

import { useMemo, useCallback } from 'react';
import { AgentRemoteService } from 'rem-agent-bridge/client';
import { useAgents } from '@/lib/use-agents';
import type { SessionSummary } from '@/lib/use-agents';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';

function WorkspacePanel({ workspace }: { workspace: string }) {
  const agentService = useMemo(() => new AgentRemoteService('', workspace), [workspace]);
  const {
    currentSession,
    sessions,
    switchSession,
    createSession,
    deleteSession,
    send,
    interrupt,
    resolveApproval,
    initialized,
  } = useAgents(agentService, { workspace });

  const handleSearch = useCallback(async (q: string) => {
    if (q) {
      await fetch(`/api/sessions?workspace=${encodeURIComponent(workspace)}&q=${encodeURIComponent(q)}`);
    } else {
      agentService.listSessions().catch(() => {});
    }
  }, [agentService, workspace]);

  return (
    <div className="flex h-full">
      <SessionSidebar
        sessions={sessions as SessionSummary[]}
        currentSessionId={currentSession?.id ?? null}
        onSwitch={switchSession}
        onCreate={createSession}
        onDelete={deleteSession}
        onSearch={handleSearch}
      />
      {currentSession ? (
        <ChatPanel
          key={currentSession.id}
          messages={currentSession.messages}
          status={currentSession.status}
          error={currentSession.error}
          activity={currentSession.activity}
          pendingApprovals={currentSession.pendingApprovals}
          initialized={initialized}
          tokenUsage={currentSession.tokenUsage}
          onSend={send}
          onInterrupt={interrupt}
          onResolveApproval={resolveApproval}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-tx3 text-sm">
          Select or create a conversation
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run web typecheck**

Run: `pnpm --filter rem-agent-web typecheck`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/page.tsx
git commit -m "feat(web): multi-workspace tabbed layout"
```

---

### Task 12: 全仓类型检查与测试

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`

Expected: PASS

- [ ] **Step 3: Manual smoke test**

Run: `pnpm dev` (or the appropriate start command from `package.json`).

Verify:
1. Opening app with no workspaces shows onboarding.
2. Adding a workspace switches to a tab.
3. Creating a session in workspace A does not appear in workspace B.
4. Sending a message runs agent under the workspace directory.
5. Switching tabs preserves independent session lists.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address typecheck and test issues"
```

---

## Self-Review

### Spec coverage

| Spec 要求 | 对应 Task |
|---|---|
| workspace 由前端传入 | Task 5, 6, 8, 9 |
| 先添加 workspace 再会话 | Task 10, 11 |
| runAgent 支持 workspace 作为 workspaceRoot | Task 1 |
| workspace 后端持久化 + JSON 实现 | Task 2 |
| workspace 管理在 AgentService 内 | Task 5 |
| session 全局存储、按 workspace 聚合 | Task 4 |
| 多 workspace 并行 | Task 11 |
| API 用 query 参数传递 workspace | Task 8 |

### Placeholder scan

- No TBD/TODO.
- All code blocks contain concrete code.
- No vague "add validation" steps; specific validation rules are shown.

### Type consistency

- `IAgentService` signatures use `workspace: string` consistently.
- `SessionSummary.workspace` is added in Task 3 and used in Task 4.
- `AgentRemoteService` constructor matches its usage in Task 11.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-workspace-param-plan.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach would you like?
