# REM 路由包与 UI 组件包拆分 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `packages/web` 中的 REM API 路由抽为 `packages/routes`（rem-agent-routes，含 CLI 一键生成薄壳 catch-all），聊天 UI 抽为 `packages/ui`（rem-agent-ui，导出 `<RemApp />` / `<RemChat />`），web 瘦身为组合层。

**Architecture:** routes 包内建路由表 + `createRemHandler()` 分发器，宿主通过生成的 `app/api/rem/[...path]/route.ts` 薄壳接入，DI 容器归宿主；UI 包复用 bridge 的 `AgentRemoteService`（新增 `apiPrefix` 选项），组件经 props 配置 `apiPrefix`，样式用宿主 Tailwind v4 + 包内 `styles.css` 主题令牌。

**Tech Stack:** TypeScript、Next.js 15 App Router、React 19、Tailwind CSS v4、tsup、vitest、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-07-24-rem-routes-ui-packages-design.md`

---

## 文件结构总览

新建：

```text
packages/routes/
  package.json  tsconfig.json
  src/
    types.ts               — GetAgentService / RemRoutesOptions / HandlerContext / Handler / RouteDefinition
    errors.ts              — toErrorResponse()
    workspace-param.ts     — getWorkspace()（从 web 迁入）
    router.ts              — createRemHandler() + 路由匹配
    handlers/agent.ts      — run / stream / interrupt / reset
    handlers/sessions.ts   — list / create / get / patch / delete / todos
    handlers/approvals.ts  — list / resolve
    handlers/workspaces.ts — list / add / remove
    index.ts               — 聚合导出
    cli.ts                 — rem-routes init
  tests/
    router.test.ts  errors.test.ts  workspace-param.test.ts  cli.test.ts

packages/ui/
  package.json  tsconfig.json  tsup.config.ts
  src/
    index.ts               — 导出 RemApp / RemChat / 类型
    styles.css             — @theme 令牌（从 web globals.css 抽出）
    components/            — 从 web/src/components 整体迁入 + RemApp.tsx / RemChat.tsx / chat-session-view.tsx
    lib/                   — 从 web/src/lib 整体迁入（use-agents、use-agent-bus、agent-bus、markdown、types、utils 等）
```

修改：

- `packages/bridge/src/agent-remote-service.ts` — 构造函数新增 `options.apiPrefix`
- `packages/web/src/app/page.tsx` — 最终变为 `<RemApp apiPrefix="/api/rem" />`
- `packages/web/src/app/api/rem/[...path]/route.ts` — CLI 生成的薄壳
- 删除 `packages/web/src/app/api/{agent,sessions,approvals,workspaces}`、`packages/web/src/app/api/workspace-param.ts`、`packages/web/src/components`、`packages/web/src/lib`
- `packages/web/src/styles/globals.css` — 引入 `rem-agent-ui/styles.css`
- `vitest.config.ts` — 增加 `rem-agent-ui` alias
- `AGENTS.md` — 项目结构更新

---

## Task 1: bridge — AgentRemoteService 支持 apiPrefix

**Files:**
- Modify: `packages/bridge/src/agent-remote-service.ts`
- Test: `packages/bridge/tests/agent-remote-service.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/bridge/tests/agent-remote-service.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRemoteService } from '../src/agent-remote-service.js';

describe('AgentRemoteService apiPrefix', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('默认使用 /api 前缀', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AgentRemoteService('http://example.com');
    await svc.listSessions('ws');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/api/sessions?workspace=ws',
      expect.anything(),
    );
  });

  it('支持自定义 apiPrefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AgentRemoteService('http://example.com', { apiPrefix: '/api/rem' });
    await svc.listSessions('ws');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/api/rem/sessions?workspace=ws',
      expect.anything(),
    );
  });

  it('apiPrefix 尾部斜杠被去除', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AgentRemoteService('http://example.com', { apiPrefix: '/api/rem/' });
    await svc.run('ws', 's1', 'hi');
    expect(fetchMock.mock.calls[0][0]).toBe('http://example.com/api/rem/agent/run?workspace=ws');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/bridge/tests/agent-remote-service.test.ts`
Expected: FAIL（构造函数第二参数不存在 / URL 不含 apiPrefix）

- [ ] **Step 3: 实现 apiPrefix 选项**

在 `packages/bridge/src/agent-remote-service.ts` 中：

1. 类前新增：

```typescript
export interface AgentRemoteServiceOptions {
  /** API 路由前缀，默认 '/api'；rem-agent-routes 默认挂载为 '/api/rem' */
  apiPrefix?: string;
}
```

2. 修改类头与构造函数：

```typescript
export class AgentRemoteService implements IAgentService {
  private resolvedBaseUrl: string;
  private apiPrefix: string;

  constructor(private baseUrl: string, options: AgentRemoteServiceOptions = {}) {
    this.resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
    this.apiPrefix = (options.apiPrefix ?? '/api').replace(/\/$/, '');
  }
```

3. 全文将 `${this.resolvedBaseUrl}/api/` 替换为 `${this.resolvedBaseUrl}${this.apiPrefix}/`（共 13 处 fetch，见文件 41/53/64/75/83/91/100/111/118/126/138/148/170/178/197 行附近）。

- [ ] **Step 4: 运行测试确认通过 + 全量回归**

Run: `pnpm vitest run packages/bridge/tests && pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/agent-remote-service.ts packages/bridge/tests/agent-remote-service.test.ts
git commit -m "feat(bridge): add apiPrefix option to AgentRemoteService"
```

---

## Task 2: routes 包脚手架

**Files:**
- Create: `packages/routes/package.json`
- Create: `packages/routes/tsconfig.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "rem-agent-routes",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "bin": {
    "rem-routes": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "cd ../.. && vitest run packages/routes/tests"
  },
  "dependencies": {
    "rem-agent-bridge": "workspace:*",
    "rem-agent-core": "workspace:*"
  },
  "peerDependencies": {
    "next": ">=15"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "next": "^15.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json（复制 bridge 配置）**

```bash
cp packages/bridge/tsconfig.json packages/routes/tsconfig.json
```

然后确认其中 `outDir` 为 `./dist`、`rootDir` 为 `./src`（与 bridge 一致即可；若 bridge tsconfig 含 `include: ["src"]` 则无需改动）。

- [ ] **Step 3: 安装依赖验证包被 workspace 识别**

Run: `pnpm install`
Expected: 无报错，`packages/routes/node_modules` 生成

- [ ] **Step 4: Commit**

```bash
git add packages/routes/package.json packages/routes/tsconfig.json pnpm-lock.yaml
git commit -m "chore(routes): scaffold rem-agent-routes package"
```

---

## Task 3: routes — types / errors / workspace-param

**Files:**
- Create: `packages/routes/src/types.ts`
- Create: `packages/routes/src/errors.ts`
- Create: `packages/routes/src/workspace-param.ts`
- Test: `packages/routes/tests/errors.test.ts`、`packages/routes/tests/workspace-param.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/routes/tests/errors.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { ServiceError } from 'rem-agent-bridge';
import { toErrorResponse } from '../src/errors.js';

describe('toErrorResponse', () => {
  it('ServiceError 保留 status 与 message', async () => {
    const res = toErrorResponse(new ServiceError(404, 'session not found'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'session not found' });
  });

  it('SyntaxError 映射为 400', async () => {
    const res = toErrorResponse(new SyntaxError('Unexpected token'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('普通 Error 映射为 500', async () => {
    const res = toErrorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('非 Error 映射为 500 Internal error', async () => {
    const res = toErrorResponse('nope');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
  });
});
```

`packages/routes/tests/workspace-param.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { getWorkspace } from '../src/workspace-param.js';

describe('getWorkspace', () => {
  it('读取 workspace 查询参数', () => {
    const req = new NextRequest('http://localhost/api/rem/agent/run?workspace=proj');
    expect(getWorkspace(req)).toBe('proj');
  });

  it('缺失时返回 default', () => {
    const req = new NextRequest('http://localhost/api/rem/agent/run');
    expect(getWorkspace(req)).toBe('default');
  });

  it('对编码后的值解码', () => {
    const req = new NextRequest('http://localhost/api/rem/agent/run?workspace=%2Ftmp%2Fws');
    expect(getWorkspace(req)).toBe('/tmp/ws');
  });
});
```

注意：`ServiceError` 构造函数签名以 `packages/bridge/src/errors.ts` 实际定义为准（可能是 `(status, message)` 或 `(message, status)`），写测试前先读该文件并按实际签名调整。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/routes/tests`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现三个文件**

`packages/routes/src/types.ts`：

```typescript
import type { NextRequest } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';

export type GetAgentService = () => Promise<IAgentService> | IAgentService;

export interface RemRoutesOptions {
  getAgentService: GetAgentService;
}

export interface HandlerContext {
  req: NextRequest;
  params: Record<string, string>;
  getAgentService: GetAgentService;
}

export type Handler = (ctx: HandlerContext) => Promise<Response>;

export interface RouteDefinition {
  pattern: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  handler: Handler;
}
```

`packages/routes/src/errors.ts`：

```typescript
import { ServiceError } from 'rem-agent-bridge';

export function toErrorResponse(err: unknown): Response {
  if (err instanceof ServiceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof SyntaxError) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return Response.json({ error: message }, { status: 500 });
}
```

`packages/routes/src/workspace-param.ts`（与 web 现实现一致）：

```typescript
import type { NextRequest } from 'next/server';

export function getWorkspace(request: NextRequest): string {
  const workspace = new URL(request.url).searchParams.get('workspace');
  // 兼容旧客户端/旧标签页以及存量 session：未传 workspace 时默认使用 'default'。
  if (!workspace) {
    return 'default';
  }
  return decodeURIComponent(workspace);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/routes/tests`
Expected: PASS（7 个用例）

- [ ] **Step 5: Commit**

```bash
git add packages/routes/src packages/routes/tests
git commit -m "feat(routes): add types, error mapping and workspace param helper"
```

---

## Task 4: routes — handlers/agent.ts

**Files:**
- Create: `packages/routes/src/handlers/agent.ts`
- Test: `packages/routes/tests/router.test.ts`（本任务先建文件，随 Task 7 补全路由级用例；handler 行为经 router 测试覆盖）

- [ ] **Step 1: 实现 handlers/agent.ts**

逻辑逐条移植自 web 现有路由（`packages/web/src/app/api/agent/{run,stream,interrupt,reset}/route.ts`）：

```typescript
import type { UserInputContent } from 'rem-agent-core';
import { log } from 'rem-agent-core';
import { createBusSSEResponse } from 'rem-agent-bridge';
import { getWorkspace } from '../workspace-param.js';
import type { RouteDefinition } from '../types.js';

async function runAgent({ req, getAgentService }: Parameters<RouteDefinition['handler']>[0]): Promise<Response> {
  const body = (await req.json()) as { sessionId?: string; content?: UserInputContent };
  const { sessionId, content } = body;
  const workspace = getWorkspace(req);

  const isEmpty =
    content === undefined ||
    content === null ||
    (typeof content === 'string' && !content) ||
    (Array.isArray(content) && content.length === 0);
  if (!sessionId || isEmpty) {
    return Response.json({ error: 'sessionId and content are required' }, { status: 400 });
  }

  log('api:run', 'run request', { sessionId, workspace });
  const service = await getAgentService();
  await service.run(workspace, sessionId, content);
  return Response.json({ ok: true });
}

async function streamAgent({ getAgentService }: Parameters<RouteDefinition['handler']>[0]): Promise<Response> {
  const service = await getAgentService();
  log('api:stream', 'SSE connection established', {});
  return createBusSSEResponse(service.stream());
}

async function interruptAgent({ req, getAgentService }: Parameters<RouteDefinition['handler']>[0]): Promise<Response> {
  const body = (await req.json()) as { sessionId?: string };
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  await service.interrupt(workspace, body.sessionId);
  return Response.json({ sessionId: body.sessionId, interrupted: true });
}

async function resetAgent({ req, getAgentService }: Parameters<RouteDefinition['handler']>[0]): Promise<Response> {
  const body = (await req.json()) as { sessionId?: string };
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  await service.reset(workspace, body.sessionId);
  return Response.json({ sessionId: body.sessionId, reset: true });
}

export const agentRoutes: RouteDefinition[] = [
  { pattern: 'agent/run', method: 'POST', handler: runAgent },
  { pattern: 'agent/stream', method: 'GET', handler: streamAgent },
  { pattern: 'agent/interrupt', method: 'POST', handler: interruptAgent },
  { pattern: 'agent/reset', method: 'POST', handler: resetAgent },
];
```

说明：`Parameters<RouteDefinition['handler']>[0]` 即 `HandlerContext`，若显得绕可在文件顶部 `import type { HandlerContext } from '../types.js'` 后直接使用 `HandlerContext`（推荐，保持可读性）。

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-routes typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/routes/src/handlers/agent.ts
git commit -m "feat(routes): port agent handlers (run/stream/interrupt/reset)"
```

---

## Task 5: routes — handlers/sessions.ts

**Files:**
- Create: `packages/routes/src/handlers/sessions.ts`

- [ ] **Step 1: 实现 handlers/sessions.ts**

移植自 `packages/web/src/app/api/sessions/route.ts`、`sessions/[id]/route.ts`、`sessions/[id]/todos/route.ts`：

```typescript
import { getWorkspace } from '../workspace-param.js';
import type { HandlerContext, RouteDefinition } from '../types.js';

async function listSessions({ req, getAgentService }: HandlerContext): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  let sessions = await service.listSessions(workspace);
  if (q) {
    const lower = q.toLowerCase();
    sessions = sessions.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
  }
  return Response.json(sessions);
}

async function createSession({ req, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const result = await service.createSession(workspace);
  return Response.json(result);
}

async function getSession({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const messages = await service.getMessages(workspace, params.id);
  return Response.json({ sessionId: params.id, title: 'New Chat', messages });
}

async function updateSession({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const body = (await req.json()) as { title?: string; pinned?: boolean };
  const service = await getAgentService();
  await service.updateSession(workspace, params.id, { title: body.title, pinned: body.pinned });
  return Response.json({ ok: true });
}

async function deleteSession({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  await service.deleteSession(workspace, params.id);
  return Response.json({ ok: true });
}

async function getTodos({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const todos = await service.getTodos(workspace, params.id);
  return Response.json(todos);
}

export const sessionRoutes: RouteDefinition[] = [
  { pattern: 'sessions', method: 'GET', handler: listSessions },
  { pattern: 'sessions', method: 'POST', handler: createSession },
  { pattern: 'sessions/:id', method: 'GET', handler: getSession },
  { pattern: 'sessions/:id', method: 'PATCH', handler: updateSession },
  { pattern: 'sessions/:id', method: 'DELETE', handler: deleteSession },
  { pattern: 'sessions/:id/todos', method: 'GET', handler: getTodos },
];
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-routes typecheck`
Expected: PASS（若 `IAgentService` 的方法名/签名与上述不符，以 `packages/bridge/src/agent-service.interface.ts` 为准调整）

- [ ] **Step 3: Commit**

```bash
git add packages/routes/src/handlers/sessions.ts
git commit -m "feat(routes): port session handlers"
```

---

## Task 6: routes — handlers/approvals.ts 与 handlers/workspaces.ts

**Files:**
- Create: `packages/routes/src/handlers/approvals.ts`
- Create: `packages/routes/src/handlers/workspaces.ts`

- [ ] **Step 1: 实现 handlers/approvals.ts**

移植自 `packages/web/src/app/api/approvals/route.ts` 与 `approvals/[id]/resolve/route.ts`：

```typescript
import type { ApprovalDecision, Rule } from 'rem-agent-core';
import { getWorkspace } from '../workspace-param.js';
import type { HandlerContext, RouteDefinition } from '../types.js';

async function listApprovals({ req, getAgentService }: HandlerContext): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const approvals = await service.listPendingApprovals(workspace, sessionId);
  return Response.json(approvals);
}

async function resolveApproval({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as {
    sessionId?: string;
    decision?: ApprovalDecision;
    rule?: Omit<Rule, 'source'>;
  };
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (!body.decision) {
    return Response.json({ error: 'decision is required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const result = await service.resolveApproval(workspace, body.sessionId, params.id, body.decision, body.rule);
  return Response.json(result);
}

export const approvalRoutes: RouteDefinition[] = [
  { pattern: 'approvals', method: 'GET', handler: listApprovals },
  { pattern: 'approvals/:id/resolve', method: 'POST', handler: resolveApproval },
];
```

- [ ] **Step 2: 实现 handlers/workspaces.ts**

移植自 `packages/web/src/app/api/workspaces/route.ts`：

```typescript
import type { HandlerContext, RouteDefinition } from '../types.js';

async function listWorkspaces({ getAgentService }: HandlerContext): Promise<Response> {
  const service = await getAgentService();
  return Response.json(await service.listWorkspaces());
}

async function addWorkspace({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { path?: string };
  if (!body.path) {
    return Response.json({ error: 'path is required' }, { status: 400 });
  }
  const service = await getAgentService();
  return Response.json(await service.addWorkspace(body.path));
}

async function removeWorkspace({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { path?: string };
  if (!body.path) {
    return Response.json({ error: 'path is required' }, { status: 400 });
  }
  const service = await getAgentService();
  await service.removeWorkspace(body.path);
  return Response.json({ ok: true });
}

export const workspaceRoutes: RouteDefinition[] = [
  { pattern: 'workspaces', method: 'GET', handler: listWorkspaces },
  { pattern: 'workspaces', method: 'POST', handler: addWorkspace },
  { pattern: 'workspaces', method: 'DELETE', handler: removeWorkspace },
];
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter rem-agent-routes typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/routes/src/handlers
git commit -m "feat(routes): port approval and workspace handlers"
```

---

## Task 7: routes — router.ts / index.ts + 路由级测试

**Files:**
- Create: `packages/routes/src/router.ts`
- Create: `packages/routes/src/index.ts`
- Test: `packages/routes/tests/router.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/routes/tests/router.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from 'rem-agent-bridge';
import { createRemHandler } from '../src/router.js';

function mockService(overrides: Record<string, unknown> = {}) {
  return {
    run: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ sessionId: 's1' }),
    getMessages: vi.fn().mockResolvedValue([]),
    updateSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getTodos: vi.fn().mockResolvedValue([]),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    resolveApproval: vi.fn().mockResolvedValue({ ok: true }),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    addWorkspace: vi.fn().mockResolvedValue({ path: '/w' }),
    removeWorkspace: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn(),
    ...overrides,
  } as never;
}

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('createRemHandler', () => {
  it('POST agent/run 调用 service.run 并返回 ok', async () => {
    const service = mockService();
    const handle = createRemHandler({ getAgentService: () => service });
    const res = await handle(post('/api/rem/agent/run?workspace=w1', { sessionId: 's1', content: 'hi' }), ['agent', 'run']);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((service as { run: ReturnType<typeof vi.fn> }).run).toHaveBeenCalledWith('w1', 's1', 'hi');
  });

  it('POST agent/run 缺 content 返回 400', async () => {
    const handle = createRemHandler({ getAgentService: () => mockService() });
    const res = await handle(post('/api/rem/agent/run', { sessionId: 's1' }), ['agent', 'run']);
    expect(res.status).toBe(400);
  });

  it('坏 JSON body 返回 400', async () => {
    const handle = createRemHandler({ getAgentService: () => mockService() });
    const req = new NextRequest('http://localhost/api/rem/agent/run', { method: 'POST', body: '{bad' });
    const res = await handle(req, ['agent', 'run']);
    expect(res.status).toBe(400);
  });

  it('GET sessions/:id 解析路径参数', async () => {
    const service = mockService();
    const handle = createRemHandler({ getAgentService: () => service });
    const res = await handle(
      new NextRequest('http://localhost/api/rem/sessions/abc?workspace=w'),
      ['sessions', 'abc'],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('abc');
  });

  it('DELETE sessions/:id 调用 deleteSession', async () => {
    const service = mockService();
    const handle = createRemHandler({ getAgentService: () => service });
    const req = new NextRequest('http://localhost/api/rem/sessions/abc', { method: 'DELETE' });
    const res = await handle(req, ['sessions', 'abc']);
    expect(res.status).toBe(200);
    expect((service as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession).toHaveBeenCalledWith('default', 'abc');
  });

  it('未匹配路径返回 404', async () => {
    const handle = createRemHandler({ getAgentService: () => mockService() });
    const res = await handle(new NextRequest('http://localhost/api/rem/nope'), ['nope']);
    expect(res.status).toBe(404);
  });

  it('ServiceError 映射其 status', async () => {
    const service = mockService({
      listSessions: vi.fn().mockRejectedValue(new ServiceError(403, 'forbidden')),
    });
    const handle = createRemHandler({ getAgentService: () => service });
    const res = await handle(new NextRequest('http://localhost/api/rem/sessions'), ['sessions']);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('普通异常映射 500', async () => {
    const service = mockService({
      listSessions: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const handle = createRemHandler({ getAgentService: () => service });
    const res = await handle(new NextRequest('http://localhost/api/rem/sessions'), ['sessions']);
    expect(res.status).toBe(500);
  });
});
```

注意：同 Task 3，`ServiceError` 构造签名以 `packages/bridge/src/errors.ts` 为准。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/routes/tests/router.test.ts`
Expected: FAIL（`createRemHandler` 不存在）

- [ ] **Step 3: 实现 router.ts 与 index.ts**

`packages/routes/src/router.ts`：

```typescript
import type { NextRequest } from 'next/server';
import { toErrorResponse } from './errors.js';
import type { RemRoutesOptions } from './types.js';
import { agentRoutes } from './handlers/agent.js';
import { sessionRoutes } from './handlers/sessions.js';
import { approvalRoutes } from './handlers/approvals.js';
import { workspaceRoutes } from './handlers/workspaces.js';

const routes = [...agentRoutes, ...sessionRoutes, ...approvalRoutes, ...workspaceRoutes];

function matchPattern(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/');
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) {
      params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
    } else if (parts[i] !== segments[i]) {
      return null;
    }
  }
  return params;
}

export function createRemHandler(opts: RemRoutesOptions) {
  return async function handleRemRequest(req: NextRequest, segments: string[]): Promise<Response> {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPattern(route.pattern, segments);
      if (!params) continue;
      try {
        return await route.handler({ req, params, getAgentService: opts.getAgentService });
      } catch (err) {
        return toErrorResponse(err);
      }
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  };
}
```

`packages/routes/src/index.ts`：

```typescript
export { createRemHandler } from './router.js';
export { toErrorResponse } from './errors.js';
export { getWorkspace } from './workspace-param.js';
export type {
  GetAgentService,
  RemRoutesOptions,
  HandlerContext,
  Handler,
  RouteDefinition,
} from './types.js';
```

- [ ] **Step 4: 运行测试确认通过 + 类型检查**

Run: `pnpm vitest run packages/routes/tests && pnpm --filter rem-agent-routes typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/routes/src/router.ts packages/routes/src/index.ts packages/routes/tests/router.test.ts
git commit -m "feat(routes): add createRemHandler router with pattern matching"
```

---

## Task 8: routes — CLI（rem-routes init）

**Files:**
- Create: `packages/routes/src/cli.ts`
- Test: `packages/routes/tests/cli.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/routes/tests/cli.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderRouteFile, resolveAppDir } from '../src/cli.js';

describe('renderRouteFile', () => {
  it('生成薄壳 route.ts，包含 container 路径引用', () => {
    const content = renderRouteFile({ containerPath: '@/lib/container' });
    expect(content).toContain("from 'rem-agent-routes'");
    expect(content).toContain("from '@/lib/container'");
    expect(content).toContain('createRemHandler');
    expect(content).toContain('route as GET');
    expect(content).toContain('route as POST');
    expect(content).toContain('route as PATCH');
    expect(content).toContain('route as DELETE');
  });
});

describe('resolveAppDir', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rem-routes-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('存在 src/app 时优先使用', () => {
    mkdirSync(join(dir, 'src/app'), { recursive: true });
    mkdirSync(join(dir, 'app'), { recursive: true });
    expect(resolveAppDir(dir)).toBe(join('src', 'app'));
  });

  it('只有 app 时使用 app', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    expect(resolveAppDir(dir)).toBe('app');
  });
});

describe('rem-routes init（构建产物端到端）', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rem-routes-e2e-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('生成文件、幂等跳过、--force 覆盖', () => {
    const cli = new URL('../dist/cli.js', import.meta.url).pathname;
    mkdirSync(join(dir, 'src/app'), { recursive: true });

    execFileSync('node', [cli, '--root', dir]);
    const target = join(dir, 'src/app/api/rem/[...path]/route.ts');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('createRemHandler');

    writeFileSync(target, '// modified');
    const out = execFileSync('node', [cli, '--root', dir], { encoding: 'utf8' });
    expect(out).toContain('已存在');
    expect(readFileSync(target, 'utf8')).toBe('// modified');

    execFileSync('node', [cli, '--root', dir, '--force']);
    expect(readFileSync(target, 'utf8')).toContain('createRemHandler');
  });
});
```

注意：端到端用例依赖 `dist/cli.js`，运行前需 `pnpm --filter rem-agent-routes build`；在测试步骤里先 build 再跑 vitest。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/routes/tests/cli.test.ts`
Expected: FAIL（`renderRouteFile` / `resolveAppDir` 不存在）

- [ ] **Step 3: 实现 cli.ts**

`packages/routes/src/cli.ts`：

```typescript
#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CliOptions {
  root: string;
  prefix: string;
  containerPath: string;
  appDir?: string;
  force: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    root: process.cwd(),
    prefix: 'api/rem',
    containerPath: '@/lib/container',
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--root': opts.root = argv[++i]; break;
      case '--prefix': opts.prefix = argv[++i].replace(/^\/|\/$/g, ''); break;
      case '--container-path': opts.containerPath = argv[++i]; break;
      case '--app-dir': opts.appDir = argv[++i]; break;
      case '--force': opts.force = true; break;
      default:
        console.error(`未知参数: ${argv[i]}`);
        process.exit(1);
    }
  }
  return opts;
}

export function resolveAppDir(root: string): string {
  if (existsSync(join(root, 'src', 'app'))) return join('src', 'app');
  if (existsSync(join(root, 'app'))) return 'app';
  return join('src', 'app');
}

export function renderRouteFile({ containerPath }: { containerPath: string }): string {
  return `import { createRemHandler } from 'rem-agent-routes';
import type { NextRequest } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { getContainer } from '${containerPath}';

const handle = createRemHandler({
  getAgentService: async () => (await getContainer()).resolve<IAgentService>('agentService'),
});

async function route(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export { route as GET, route as POST, route as PATCH, route as DELETE, route as PUT };
`;
}

export function run(argv: string[]): void {
  const opts = parseArgs(argv);
  const appDir = opts.appDir ?? resolveAppDir(opts.root);
  const dir = join(opts.root, appDir, ...opts.prefix.split('/'), '[...path]');
  const target = join(dir, 'route.ts');

  if (existsSync(target) && !opts.force) {
    console.log(`已存在，跳过（使用 --force 覆盖）: ${target}`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, renderRouteFile({ containerPath: opts.containerPath }));
  console.log(`已生成: ${target}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain) {
  run(process.argv.slice(2));
}
```

注意：`isMain` 判断在构建后可能不可靠。更稳妥的做法：把可执行入口与库代码分开——`cli.ts` 只导出函数，另建 `src/bin.ts`（内容：`#!/usr/bin/env node\nimport { run } from './cli.js';\nrun(process.argv.slice(2));`），`package.json` 的 `bin` 指向 `./dist/bin.js`，tsconfig `include` 覆盖两者。采用此方案时测试中的 `dist/cli.js` 改为 `dist/bin.js`。

- [ ] **Step 4: 构建并运行测试**

Run: `pnpm --filter rem-agent-routes build && pnpm vitest run packages/routes/tests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/routes/src/cli.ts packages/routes/src/bin.ts packages/routes/tests/cli.test.ts packages/routes/package.json
git commit -m "feat(routes): add rem-routes init CLI"
```

---

## Task 9: web 切换到薄壳路由

**Files:**
- Create: `packages/web/src/app/api/rem/[...path]/route.ts`（CLI 生成）
- Modify: `packages/web/src/app/page.tsx:4`（AgentRemoteService 构造）
- Modify: `packages/web/src/app/page.tsx`（handleSearch 中的 fetch 路径）
- Modify: `packages/web/src/lib/use-agents.ts:677,692`（裸 fetch → service 方法）
- Modify: `packages/web/package.json`（新增依赖）
- Delete: `packages/web/src/app/api/agent`、`packages/web/src/app/api/sessions`、`packages/web/src/app/api/approvals`、`packages/web/src/app/api/workspaces`、`packages/web/src/app/api/workspace-param.ts`

- [ ] **Step 1: web 增加依赖并安装**

在 `packages/web/package.json` dependencies 增加 `"rem-agent-routes": "workspace:*"`，然后：

Run: `pnpm install && pnpm --filter rem-agent-routes build`

- [ ] **Step 2: 用 CLI 生成薄壳路由**

Run: `node packages/routes/dist/bin.js --root packages/web --container-path '@/lib/container'`
Expected: 输出 `已生成: packages/web/src/app/api/rem/[...path]/route.ts`

- [ ] **Step 3: 切换前端调用前缀**

`packages/web/src/app/page.tsx` 第 14 行：

```typescript
// 旧
const agentService = useMemo(() => new AgentRemoteService(''), []);
// 新
const agentService = useMemo(() => new AgentRemoteService('', { apiPrefix: '/api/rem' }), []);
```

`page.tsx` 的 `handleSearch`（约 92 行）：

```typescript
// 旧
await fetch(`/api/sessions?workspace=${encodeURIComponent(activeWorkspace)}&q=${encodeURIComponent(q)}`);
// 新
await fetch(`/api/rem/sessions?workspace=${encodeURIComponent(activeWorkspace)}&q=${encodeURIComponent(q)}`);
```

`packages/web/src/lib/use-agents.ts`（这两处裸 fetch 改为走 service，天然带上新前缀；先读 `packages/bridge/src/agent-service.interface.ts` 确认 `createSession`/`deleteSession` 返回类型）：

```typescript
// 675-687 行 createSession 内：
// 旧
const res = await fetch(`/api/sessions?workspace=${encodeURIComponent(workspace)}`, { method: 'POST' });
if (!res.ok) throw new Error('Failed to create');
const session = await res.json() as SessionSummary;
// 新
const session = await agentService.createSession(workspace) as SessionSummary;
```

```typescript
// 689-692 行 deleteSession 内：
// 旧
await fetch(`/api/sessions/${id}?workspace=${encodeURIComponent(workspace)}`, { method: 'DELETE' });
// 新
await agentService.deleteSession(workspace, id);
```

注意：`useAgents(agentService, ...)` 的第一个参数名以实际函数签名为准；若 hooks 内变量名不是 `agentService`，用实际变量名。若 `createSession` 返回类型与 `SessionSummary` 不一致（如字段名 `sessionId` vs `id`），保留裸 fetch 但改为模板字符串 `${apiPrefix}` 不可行（hook 拿不到 apiPrefix）——此时改为从 `agentService` 上读取：给 hook 增加第三参数或改用 service 方法并做字段映射。优先方案是 service 方法 + 字段映射。

- [ ] **Step 4: 删除旧路由目录**

```bash
git rm -r packages/web/src/app/api/agent packages/web/src/app/api/sessions packages/web/src/app/api/approvals packages/web/src/app/api/workspaces packages/web/src/app/api/workspace-param.ts
```

- [ ] **Step 5: 验证**

Run: `pnpm --filter rem-agent-web typecheck && pnpm test`
Expected: PASS

手动验证（必须执行）：`pnpm --filter rem-agent-web dev`，打开 http://localhost:3000，验证：发消息流式回复、中断、新建/删除会话、审批、切换 workspace。可用 agent-browser skill 自动化验证。

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): switch to rem-agent-routes catch-all under /api/rem"
```

---

## Task 10: ui 包脚手架

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/tsup.config.ts`
- Modify: `vitest.config.ts`（alias）

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "rem-agent-ui",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./styles.css": "./dist/styles.css"
  },
  "scripts": {
    "build": "tsup && cp src/styles.css dist/styles.css",
    "typecheck": "tsc --noEmit",
    "test": "cd ../.. && vitest run packages/ui"
  },
  "dependencies": {
    "clsx": "^2.1.0",
    "github-markdown-css": "^5.9.0",
    "lucide-react": "^0.400.0",
    "marked": "^18.0.0",
    "marked-shiki": "^1.2.0",
    "react-virtuoso": "^4.0.0",
    "rem-agent-bridge": "workspace:*",
    "rem-agent-core": "workspace:*",
    "shiki": "^4.0.0",
    "tailwind-merge": "^2.6.0",
    "uuid": "^11.0.0",
    "zustand": "^5.0.0"
  },
  "peerDependencies": {
    "react": ">=19",
    "react-dom": ">=19",
    "tailwindcss": ">=4"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^24.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  banner: { js: '"use client";' },
  external: ['react', 'react-dom', 'react/jsx-runtime', 'tailwindcss'],
});
```

- [ ] **Step 4: vitest alias**

`vitest.config.ts` 的 `resolve.alias` 数组中追加（放在 `rem-agent-bridge` 之后）：

```typescript
{ find: 'rem-agent-ui', replacement: resolve(__dirname, 'packages/ui/src/index.ts') },
```

同时将 `'@/'` alias 保留（web 仍在用，直到 Task 15 完成后再评估移除）。

- [ ] **Step 5: 安装验证**

Run: `pnpm install`
Expected: 无报错

- [ ] **Step 6: Commit**

```bash
git add packages/ui/package.json packages/ui/tsconfig.json packages/ui/tsup.config.ts vitest.config.ts pnpm-lock.yaml
git commit -m "chore(ui): scaffold rem-agent-ui package"
```

---

## Task 11: ui — 迁移 lib 与 components

**Files:**
- Move: `packages/web/src/lib/**` → `packages/ui/src/lib/**`
- Move: `packages/web/src/components/**` → `packages/ui/src/components/**`
- Modify: `packages/web/src/app/page.tsx`（临时改为从 `rem-agent-ui` 引用或保持 `@/` 直到 Task 12；本任务选择保持 web 可编译）

- [ ] **Step 1: git mv 迁移**

```bash
mkdir -p packages/ui/src
git mv packages/web/src/lib packages/ui/src/lib
git mv packages/web/src/components packages/ui/src/components
```

- [ ] **Step 2: 修正迁移后文件的 import**

规则（对 `packages/ui/src/**` 全部 `.ts/.tsx`）：

1. `@/lib/` → 相对路径：`components/<group>/*.tsx` 中为 `../../lib/`；`lib/*.ts` 内部互相引用本就是 `./`，无需改。
2. `@/components/` → `../`（如 `@/components/chat/chat-panel` → `../chat/chat-panel`，以实际引用点深度为准）。
3. `@/styles/globals.css` 或类似 CSS import：globals 留在 web，组件内不应 import 它；若有 `github-markdown-css` 的 import 保留（已是包依赖）。

用 grep 找出全部待改点：`grep -rn "@/" packages/ui/src`，逐一改为相对路径。

- [ ] **Step 3: web 侧临时改引用**

`packages/web/src/app/page.tsx` 中 `@/lib/use-agents`、`@/components/...` 等 import 全部改为从包引用前的临时方案——由于 Task 12 马上会把 page.tsx 替换为 `<RemApp />`，本步骤直接将 import 路径改为相对指向 ui 源码会破坏分层；正确顺序是：本步先让 web 编译失败可接受，直接进入 Task 12/13 完成 `RemApp` 后再统一修 web。**执行时 Task 11-14 作为一个连续单元提交前不单独验证 web typecheck**，只验证 `pnpm --filter rem-agent-ui typecheck`。

- [ ] **Step 4: ui 包类型检查**

Run: `pnpm --filter rem-agent-ui typecheck`
Expected: PASS（若报 `rem-agent-bridge/client` 子路径解析问题，确认 ui tsconfig `moduleResolution: bundler` 且 bridge package.json 有 `./client` export——已有）

- [ ] **Step 5: 迁移 lib 层测试并跑通**

web 原有测试文件随目录一并迁移（`lib/*.test.ts`、`components/chat/*.test.tsx`）。测试内的 `@/` import 同样按 Step 2 规则修正。

Run: `pnpm vitest run packages/ui`
Expected: 原 web 的测试全部 PASS（jsdom 环境用例若依赖 `@testing-library/jest-dom` setup，确认根 vitest.config 的 `setupFiles` 覆盖；`packages/core/tests/setup.ts` 若不含 jest-dom，则在测试文件内 `import '@testing-library/jest-dom/vitest'`——以迁移前 web 测试如何运行成功为准照搬）

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src packages/web/src
git commit -m "refactor(ui): move web lib and components into rem-agent-ui"
```

---

## Task 12: ui — styles.css 主题令牌

**Files:**
- Create: `packages/ui/src/styles.css`
- Modify: `packages/web/src/styles/globals.css`

- [ ] **Step 1: 抽取主题到 ui 包**

创建 `packages/ui/src/styles.css`，内容 = web `globals.css` 中的 `@variant dark`、`@theme inline { ... }`、`@utility scrollbar-thin` 三段（不含 `@import 'tailwindcss'`、不含 `@import 'github-markdown-css/...'`、不含 `@layer base` 的 body 样式——body 背景归宿主页面）。

- [ ] **Step 2: web globals.css 改为引入**

`packages/web/src/styles/globals.css` 头部改为：

```css
@import 'tailwindcss';
@import 'github-markdown-css/github-markdown-dark.css';
@import 'rem-agent-ui/styles.css';
```

并删除已抽走的 `@variant dark` / `@theme inline` / `@utility scrollbar-thin` 段（保留 `@layer base` 与 `.markdown-body` 等页面级样式）。

- [ ] **Step 3: 验证样式不回归**

Run: `pnpm --filter rem-agent-ui build && pnpm --filter rem-agent-web build`
Expected: 构建成功；`packages/ui/dist/styles.css` 存在。随后 dev 模式目测页面样式无变化（可用 agent-browser 截图对比）。

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/styles.css packages/web/src/styles/globals.css
git commit -m "refactor(ui): extract theme tokens into rem-agent-ui styles.css"
```

---

## Task 13: ui — ChatSessionView / RemChat / RemApp

**Files:**
- Create: `packages/ui/src/components/chat-session-view.tsx`
- Create: `packages/ui/src/components/RemChat.tsx`
- Create: `packages/ui/src/components/RemApp.tsx`

命名遵循现有 kebab-case 约定，实际文件名为 `rem-app.tsx` / `rem-chat.tsx`（组件名 PascalCase）。

- [ ] **Step 1: 实现 chat-session-view.tsx（内部组件，抽自 page.tsx 的聊天区 + 抽屉逻辑）**

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IAgentService } from 'rem-agent-bridge/client';
import { ChatPanel } from './chat/chat-panel';
import { ChildAgentDrawer } from './chat/child-agent-drawer';
import type { useAgents } from '../lib/use-agents';

type Agents = ReturnType<typeof useAgents>;

export interface ChatSessionViewProps {
  agentService: IAgentService;
  workspace: string;
  agents: Agents;
}

export function ChatSessionView({ agentService, workspace, agents }: ChatSessionViewProps) {
  const { currentSession, switchSession, send, interrupt, resolveApproval, initialized, getSessionState, loadSession } = agents;
  const [drawerChildId, setDrawerChildId] = useState<string | null>(null);

  const currentSessionId = currentSession?.id ?? null;
  useEffect(() => {
    setDrawerChildId(null);
  }, [currentSessionId, workspace]);

  const handleOpenChild = useCallback((sessionId: string) => {
    loadSession(sessionId);
    setDrawerChildId(sessionId);
  }, [loadSession]);

  const handleOpenChildFull = useCallback((sessionId: string) => {
    setDrawerChildId(null);
    switchSession(sessionId);
  }, [switchSession]);

  const drawerChild = drawerChildId ? currentSession?.childAgents.get(drawerChildId) ?? null : null;
  const drawerSession = drawerChildId ? getSessionState(drawerChildId) : null;

  if (!currentSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-tx3 text-sm">
        Select or create a conversation
      </div>
    );
  }

  return (
    <>
      <ChatPanel
        key={`${workspace}-${currentSession.id}`}
        messages={currentSession.messages}
        status={currentSession.status}
        error={currentSession.error}
        activity={currentSession.activity}
        pendingApprovals={currentSession.pendingApprovals}
        initialized={initialized}
        tokenUsage={currentSession.tokenUsage}
        childAgents={currentSession.childAgents}
        onOpenChild={handleOpenChild}
        onSend={send}
        onInterrupt={interrupt}
        onResolveApproval={resolveApproval}
        agentService={agentService}
        workspace={workspace}
        sessionId={currentSession.id}
      />
      {drawerChild && (
        <ChildAgentDrawer
          child={drawerChild}
          session={drawerSession}
          onClose={() => setDrawerChildId(null)}
          onOpenFull={handleOpenChildFull}
        />
      )}
    </>
  );
}
```

注意：`useAgents` 的返回字段名以 `packages/ui/src/lib/use-agents.ts` 实际为准逐一核对（page.tsx 中已用到这些字段，迁移后不变）。

- [ ] **Step 2: 实现 rem-chat.tsx**

```typescript
'use client';

import { useEffect, useMemo } from 'react';
import { AgentRemoteService } from 'rem-agent-bridge/client';
import { useAgents } from '../lib/use-agents';
import { ChatSessionView } from './chat-session-view';

export interface RemChatProps {
  sessionId: string;
  workspace?: string;
  apiPrefix?: string;
  baseUrl?: string;
  className?: string;
}

export function RemChat({ sessionId, workspace = 'default', apiPrefix = '/api/rem', baseUrl = '', className }: RemChatProps) {
  const agentService = useMemo(
    () => new AgentRemoteService(baseUrl, { apiPrefix }),
    [baseUrl, apiPrefix],
  );
  const agents = useAgents(agentService, { workspace });
  const { switchSession, currentSession } = agents;

  useEffect(() => {
    switchSession(sessionId);
  }, [sessionId, switchSession]);

  if (!currentSession || currentSession.id !== sessionId) {
    return (
      <div className={className}>
        <div className="flex h-full items-center justify-center text-tx2 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className={className ?? 'flex h-full flex-1'}>
      <ChatSessionView agentService={agentService} workspace={workspace} agents={agents} />
    </div>
  );
}
```

- [ ] **Step 3: 实现 rem-app.tsx（page.tsx 组合逻辑整体迁入）**

以 `packages/web/src/app/page.tsx` 迁移前内容为蓝本，改动点：

1. `'use client'` 保留；
2. `new AgentRemoteService('')` → `new AgentRemoteService(baseUrl, { apiPrefix })`；
3. `handleSearch` 中 fetch 路径 → `${apiPrefix}/sessions?...`；
4. 聊天区 + `ChildAgentDrawer` 块替换为 `<ChatSessionView agentService={agentService} workspace={activeWorkspace} agents={agents} />`（`agents` 为 `useAgents(...)` 的完整返回值）；
5. 导出 props：

```typescript
export interface RemAppProps {
  apiPrefix?: string;  // 默认 '/api/rem'
  baseUrl?: string;    // 默认 ''（同源）
  className?: string;
}

export function RemApp({ apiPrefix = '/api/rem', baseUrl = '', className }: RemAppProps) { ... }
```

`page.tsx` 中的 workspace 加载、pendingCreate、handleAddWorkspace/handleRemoveWorkspace/handleCreateSession、`WorkspaceSidebar`、`AddWorkspaceDialog`、`loaded` 逻辑原样保留。最外层 `<div className="flex h-full">` 改为 `<div className={className ?? 'flex h-full'}>`。

- [ ] **Step 4: 类型检查 + 测试**

Run: `pnpm --filter rem-agent-ui typecheck && pnpm vitest run packages/ui`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat-session-view.tsx packages/ui/src/components/rem-chat.tsx packages/ui/src/components/rem-app.tsx
git commit -m "feat(ui): add RemApp, RemChat and ChatSessionView components"
```

---

## Task 14: ui — index.ts 导出 + 构建验证

**Files:**
- Create: `packages/ui/src/index.ts`

- [ ] **Step 1: 实现 index.ts**

```typescript
export { RemApp } from './components/rem-app';
export type { RemAppProps } from './components/rem-app';
export { RemChat } from './components/rem-chat';
export type { RemChatProps } from './components/rem-chat';
```

（hooks/lib 暂不导出，YAGNI；后续有需要再加子路径导出。）

- [ ] **Step 2: 构建**

Run: `pnpm --filter rem-agent-ui build`
Expected: `dist/index.js`、`dist/index.cjs`、`dist/index.d.ts`、`dist/styles.css` 生成；`dist/index.js` 首行含 `"use client";`

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/index.ts
git commit -m "feat(ui): add package entry exports"
```

---

## Task 15: web 瘦身

**Files:**
- Modify: `packages/web/src/app/page.tsx`
- Modify: `packages/web/package.json`（新增 rem-agent-ui 依赖；移除已不需要的直接依赖可留待后续，本任务不动）
- Modify: `packages/web/tailwind` 配置或 globals.css（确保 Tailwind v4 扫描到 ui 包源码）

- [ ] **Step 1: page.tsx 替换**

```typescript
'use client';

import { RemApp } from 'rem-agent-ui';

export default function Home() {
  return <RemApp apiPrefix="/api/rem" />;
}
```

- [ ] **Step 2: 依赖与样式扫描**

1. `packages/web/package.json` dependencies 增加 `"rem-agent-ui": "workspace:*"`，`pnpm install`。
2. Tailwind v4 默认自动扫描内容，但 `node_modules` 内文件不会被扫到。在 `packages/web/src/styles/globals.css` 顶部（`@import 'tailwindcss';` 之后）加：

```css
@source "../../ui/src";
```

（monorepo 内直接指向 ui 源码目录，保证开发期类名被收集；路径以 globals.css 相对位置为准。）

- [ ] **Step 3: 全量验证**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

手动验证（必须执行）：dev 启动后完整走一遍发消息/SSE/审批/workspace 切换/会话管理，确认与迁移前一致（用 agent-browser）。

- [ ] **Step 4: Commit**

```bash
git add packages/web
git commit -m "refactor(web): slim down to RemApp composition over rem-agent-ui"
```

---

## Task 16: 文档更新

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新 AGENTS.md 项目结构**

`packages/` 列表改为：

```text
packages/
  core/    — rem-agent-core：生命周期、ReAct 循环、事件、预算、LLM 抽象层
  bridge/  — rem-agent-bridge：HTTP client/server、SSE 编解码、AgentService
  routes/  — rem-agent-routes：Next.js REM API 路由包（createRemHandler + rem-routes init CLI）
  ui/      — rem-agent-ui：React 聊天组件包（<RemApp /> / <RemChat />，apiPrefix 可配）
  web/     — rem-agent-web：Next.js 15 + React 19 宿主应用（薄组合层）
```

常用入口表追加：

```text
| `packages/routes/src/router.ts` | `createRemHandler`：REM API 路由分发 |
| `packages/routes/src/cli.ts` | `rem-routes init`：生成宿主薄壳路由 |
| `packages/ui/src/components/rem-app.tsx` | `<RemApp />` 完整聊天应用 |
| `packages/ui/src/components/rem-chat.tsx` | `<RemChat />` 单独聊天框 |
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update project structure for routes and ui packages"
```

---

## 验收清单

- [ ] `pnpm typecheck && pnpm test` 全绿
- [ ] `node packages/routes/dist/bin.js --root <任意Next宿主>` 可在新宿主生成薄壳路由
- [ ] web 全流程手动验证通过（消息流、审批、workspace、会话管理）
- [ ] `<RemChat sessionId=... />` 可在最小页面独立渲染（可在 web 加一个临时试炼页验证后删除，或留待后续）
