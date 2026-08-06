# Rem Web UI 重建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `packages/web`（Hono server + React/Vite 前端），基于 `AgentSystem` 门面提供单/多 Agent 的最小可用 Web UI。

**Architecture:** 单进程 Hono server 常驻 `AgentSystem` 实例，REST + 单条 SSE（`event: bus`）对前端暴露；前端用 shadcn/ui（定制 dark 工作台主题）+ zustand 状态层，中心流只显示公开消息，多 Agent 细节收进右侧 Thread 面板。

**Tech Stack:** TypeScript、Hono 4、React 19、Vite 6、Tailwind v4、shadcn/ui、zustand、marked + shiki、Vitest。

**Spec:** `docs/superpowers/specs/2026-08-06-web-ui-rebuild-design.md`

**模块纪律：** 遵循 module-separation-convention——类型/实现分离、单文件职责单一、实现文件 ≤200 行、入口文件 ≤120 行、kebab-case 文件名、`import type` 与值导入分离、Core 内导入带 `.js` 扩展名。

---

## File Structure

**Core 改动（3 个文件 + 2 个测试）：**
- `packages/core/src/sdk/config-provider.ts` — 加 `TeamInfo` 类型与 `ConfigProvider.listTeams()`
- `packages/core/src/plugins/config/default/default-config-provider.ts` — 实现 `listTeams`
- `packages/core/src/system/types.ts` + `packages/core/src/system/agent-system.ts` — `AgentSystem.listTeams` + 实现
- `packages/core/src/orchestration/single-agent-run-driver.ts` — chunk 事件补 `agentThreadId`
- 测试：`packages/core/tests/default-config-provider.test.ts`、`packages/core/tests/agent-system.test.ts`

**packages/web 新建：**

```text
packages/web/
  package.json  tsconfig.json  tsconfig.server.json  vite.config.ts  vitest.config.ts  components.json
  index.html
  src/
    server/
      index.ts          # CLI 入口（--workspace/--port、静态文件）
      app.ts            # createWebApp(deps): Hono
      errors.ts         # Core 错误 → HTTP 响应映射
      routes/sessions.ts  routes/teams.ts  routes/stream.ts
    client/
      main.tsx  app.tsx  index.css
      api/client.ts     # REST fetch 封装
      api/sse.ts        # parseSSEStream（移植自 archive/bridge/src/sse.ts）
      api/bus.ts        # SSE 单例 + 指数退避重连
      state/stream-reducer.ts  # chunk → ContentBlock[]（移植 archive 思路，新类型）
      state/stream-store.ts    # zustand store
      lib/utils.ts      # cn()
      lib/markdown.ts   # 移植 archive/ui/src/lib/markdown.ts
      components/ui/    # shadcn add 生成
      components/top-bar.tsx  status-bar.tsx  session-list.tsx  new-session-dialog.tsx
      components/chat-view.tsx  message-item.tsx  composer.tsx
      components/thread-panel.tsx
      components/markdown-content.tsx  tool-call-block.tsx  reasoning-block.tsx
  tests/
    helpers/fake-agent-system.ts
    server-routes.test.ts  server-stream.test.ts
    stream-reducer.test.ts  stream-store.test.ts  api-client.test.ts  bus.test.ts
    thread-panel.test.tsx  chat-view.test.tsx
```

---

## Task 1: Core — `ConfigProvider.listTeams` + `TeamInfo`

**Files:**
- Modify: `packages/core/src/sdk/config-provider.ts`（`TeamConfig` 附近，:33-37）
- Modify: `packages/core/src/plugins/config/default/default-config-provider.ts`（`resolveTeam` 方法后，:162-165）
- Test: `packages/core/tests/default-config-provider.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/tests/default-config-provider.test.ts` 追加：

```typescript
it('listTeams returns configured teams with organizer and members', () => {
  const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
  expect(provider.listTeams()).toEqual([]);
});
```

（`paths` 指向不存在的目录，raw config 为空，teams 缺省应为空数组。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- --run packages/core/tests/default-config-provider.test.ts -t listTeams`
Expected: FAIL，`provider.listTeams is not a function`

- [ ] **Step 3: 在 SDK 接口中加类型与方法**

`packages/core/src/sdk/config-provider.ts`，在 `TeamConfig` 定义后追加：

```typescript
export interface TeamInfo {
  id: string;
  organizer: string;
  members: string[];
}
```

在 `ConfigProvider` 接口的 `resolveTeam(id: string): ResolvedTeam;` 后追加：

```typescript
  listTeams(): TeamInfo[];
```

- [ ] **Step 4: DefaultConfigProvider 实现**

`packages/core/src/plugins/config/default/default-config-provider.ts`，在 `resolveTeam` 方法后追加：

```typescript
  listTeams(): TeamInfo[] {
    const teams = this.getRawConfig().teams ?? {};
    return Object.entries(teams).map(([id, team]) => ({
      id,
      organizer: team.organizer,
      members: [...team.members],
    }));
  }
```

- [ ] **Step 5: 运行确认通过 + 全量 typecheck**

Run: `pnpm test -- --run packages/core/tests/default-config-provider.test.ts && pnpm --filter rem-agent-core typecheck`
Expected: PASS。注意：`ConfigProvider` 加了方法后若有其他实现类（搜索 `implements ConfigProvider`），需一并补 `listTeams` 或确认只有 DefaultConfigProvider 一个实现。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sdk/config-provider.ts packages/core/src/plugins/config/default/default-config-provider.ts packages/core/tests/default-config-provider.test.ts
git commit -m "feat(core): add ConfigProvider.listTeams for team discovery"
```

---

## Task 2: Core — `AgentSystem.listTeams`

**Files:**
- Modify: `packages/core/src/system/types.ts:26-36`（`AgentSystem` 接口）
- Modify: `packages/core/src/system/agent-system.ts`（`createSession` 后）
- Modify: `packages/core/src/system/index.ts`（导出 `TeamInfo` 无需，sdk 已 `export *`）
- Test: `packages/core/tests/agent-system.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/tests/agent-system.test.ts` 追加：

```typescript
it('listTeams delegates to config provider', async () => {
  const assembly = await createFakeAssembly({ models: createScriptedModels([]).models });
  const system = createAgentSystem(assembly);
  expect(await system.listTeams()).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- --run packages/core/tests/agent-system.test.ts -t listTeams`
Expected: FAIL，`system.listTeams is not a function`

- [ ] **Step 3: 接口 + 实现**

`packages/core/src/system/types.ts`，先补 import（文件顶部 `import type` 区）：

```typescript
import type { TeamInfo } from '../sdk/config-provider.js';
```

`AgentSystem` 接口中 `createSession` 后追加：

```typescript
  listTeams(): Promise<TeamInfo[]>;
```

`packages/core/src/system/agent-system.ts`，`createSession` 方法后追加：

```typescript
  async listTeams(): Promise<TeamInfo[]> {
    return this.deps.di.configProvider.listTeams();
  }
```

（文件顶部需补 `import type { TeamInfo } from '../sdk/config-provider.js';`）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test -- --run packages/core/tests/agent-system.test.ts && pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/system/types.ts packages/core/src/system/agent-system.ts packages/core/tests/agent-system.test.ts
git commit -m "feat(core): expose AgentSystem.listTeams"
```

---

## Task 3: Core — 单 Agent chunk 事件补 `agentThreadId`

**Files:**
- Modify: `packages/core/src/orchestration/single-agent-run-driver.ts:56`
- Test: `packages/core/tests/agent-system.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/tests/agent-system.test.ts` 追加：

```typescript
it('单 Agent chunk 事件携带 agentThreadId', async () => {
  const scripted = createScriptedModels([() => fauxAssistantMessage('hi')]);
  const assembly = await createFakeAssembly({ models: scripted.models });
  const system = createAgentSystem(assembly);
  const session = await system.createSession({ workspace: 'ws' });
  const threads = await system.getSessionThreads(session.sessionId);

  const terminal = waitForTerminal(system.events(), session.sessionId);
  await system.send({ sessionId: session.sessionId, content: 'hello' });
  const events = await terminal;

  const chunks = events.filter((e) => e.type === 'chunk');
  expect(chunks.length).toBeGreaterThan(0);
  for (const chunk of chunks) {
    expect(chunk.agentThreadId).toBe(threads[0].agentThreadId);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- --run packages/core/tests/agent-system.test.ts -t agentThreadId`
Expected: FAIL，`expected undefined to be ...`

- [ ] **Step 3: 修改 publish 调用**

`packages/core/src/orchestration/single-agent-run-driver.ts:56`：

```typescript
        this.publish(runtime, { type: 'chunk', chunk: event, agentId: agent.agentId, agentThreadId: runtime.agentThreadId });
```

- [ ] **Step 4: 运行确认通过 + 全套测试**

Run: `pnpm test && pnpm --filter rem-agent-core typecheck && pnpm check:structure`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/orchestration/single-agent-run-driver.ts packages/core/tests/agent-system.test.ts
git commit -m "feat(core): include agentThreadId in single-agent chunk events"
```

---

## Task 4: packages/web 脚手架

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`、`packages/web/tsconfig.server.json`
- Create: `packages/web/vite.config.ts`、`packages/web/vitest.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/client/main.tsx`（占位）
- Modify: `package.json`（根 scripts）

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "rem-agent-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -k \"pnpm:dev:server\" \"pnpm:dev:client\"",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:client": "vite",
    "build": "tsc -p tsconfig.server.json && vite build",
    "start": "cross-env NODE_ENV=production node dist/server/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.server.json"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "hono": "^4.6.14",
    "rem-agent-core": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.2",
    "marked": "^15.0.4",
    "marked-shiki": "^1.1.1",
    "shiki": "^1.24.2",
    "lucide-react": "^0.469.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "class-variance-authority": "^0.7.1",
    "tw-animate-css": "^1.2.4"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "concurrently": "^9.1.0",
    "cross-env": "^7.0.3",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.4.0",
    "vite": "^6.0.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: tsconfig（client）`packages/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/client/*"],
      "rem-agent-core": ["../core/src/index.ts"]
    }
  },
  "include": ["src/client", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

`packages/web/tsconfig.server.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist/server",
    "rootDir": "src/server",
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "rem-agent-core": ["../core/src/index.ts"]
    }
  },
  "include": ["src/server"]
}
```

注意：tsconfig paths 只在 typecheck/编辑器生效；vite/vitest 用 resolve.alias 对齐（见下）。server 运行时经 tsx 或 tsc 产物引用 `rem-agent-core` 的 dist（pnpm workspace 链接），所以 `pnpm build` 必须先构建 core（根脚本保证顺序）。

- [ ] **Step 3: `packages/web/vite.config.ts`**

```typescript
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/client'),
      'rem-agent-core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { outDir: 'dist/client' },
});
```

- [ ] **Step 4: `packages/web/vitest.config.ts`**

```typescript
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/client'),
      'rem-agent-core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
});
```

- [ ] **Step 5: `packages/web/index.html` 与占位 `src/client/main.tsx`**

```html
<!doctype html>
<html lang="zh-CN" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rem Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

```tsx
import { createRoot } from 'react-dom/client';
import './index.css';

createRoot(document.getElementById('root')!).render(<div>Rem Web</div>);
```

同时创建空占位 `packages/web/src/client/index.css`（下个任务填主题）。

- [ ] **Step 6: 根 `package.json` scripts 更新**

```json
    "build": "pnpm --filter rem-agent-core build && pnpm --filter rem-agent-web build",
    "test": "vitest run packages/core/tests && pnpm --filter rem-agent-web test",
    "typecheck": "pnpm --filter rem-agent-core build && pnpm --filter rem-agent-core typecheck && pnpm --filter rem-agent-web typecheck",
    "dev:web": "pnpm --filter rem-agent-web dev"
```

- [ ] **Step 7: 安装 + 验证**

Run: `pnpm install && pnpm --filter rem-agent-web typecheck`
Expected: 依赖安装成功；typecheck 通过（`index.css` 空文件可被 main.tsx 引用）

- [ ] **Step 8: Commit**

```bash
git add packages/web package.json pnpm-lock.yaml
git commit -m "feat(web): scaffold rem-agent-web package"
```

---

## Task 5: Tailwind v4 + shadcn/ui 初始化 + 工作台 dark 主题

**Files:**
- Create: `packages/web/components.json`
- Create: `packages/web/src/client/lib/utils.ts`
- Modify: `packages/web/src/client/index.css`

- [ ] **Step 1: `components.json`（手动创建，避免交互式 CLI）**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/client/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 2: `src/client/lib/utils.ts`**

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: `src/client/index.css`——Tailwind v4 + shadcn token + 工作台暗色定制**

```css
@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.5rem;
}

.dark {
  /* 暗色紧凑工作台：参考 darlulu workbench */
  --background: #08090c;
  --foreground: #eeeeee;
  --card: #12141a;
  --card-foreground: #eeeeee;
  --popover: #12141a;
  --popover-foreground: #eeeeee;
  --primary: #6752da;
  --primary-foreground: #ffffff;
  --secondary: #181a20;
  --secondary-foreground: #d6d7dc;
  --muted: #181a20;
  --muted-foreground: #737680;
  --accent: #28233d;
  --accent-foreground: #e8e4ff;
  --destructive: #b34040;
  --destructive-foreground: #ffffff;
  --border: #292b32;
  --input: #383b44;
  --ring: #7059ed;
  --radius: 0.5rem;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
}

body {
  background: var(--background);
  color: var(--foreground);
  font: 12px/1.45 Inter, 'PingFang SC', sans-serif;
}
```

- [ ] **Step 4: shadcn add 组件**

Run（workdir: `packages/web`）:

```bash
pnpm dlx shadcn@latest add button badge card tabs scroll-area separator select textarea dialog
```

完成后检查 `src/client/components/ui/` 已生成，且 `@/lib/utils` 引用正确。

- [ ] **Step 5: 验证**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): init shadcn/ui with dark workbench theme"
```

---

## Task 6: server — 错误映射 + app 骨架 + sessions/teams 路由

**Files:**
- Create: `packages/web/src/server/errors.ts`
- Create: `packages/web/src/server/app.ts`
- Create: `packages/web/src/server/routes/sessions.ts`
- Create: `packages/web/src/server/routes/teams.ts`
- Test: `packages/web/tests/helpers/fake-agent-system.ts`、`packages/web/tests/server-routes.test.ts`

- [ ] **Step 1: fake AgentSystem（测试助手）**

`packages/web/tests/helpers/fake-agent-system.ts`：

```typescript
import type {
  AgentSystem, AgentSystemEvent, AgentThread, SessionChatMessage, SessionInfo, TeamInfo, Message,
} from 'rem-agent-core';

export interface FakeAgentSystemOptions {
  sessions?: SessionInfo[];
  teams?: TeamInfo[];
  chat?: SessionChatMessage[];
  threads?: AgentThread[];
  threadMessages?: Message[];
  events?: AgentSystemEvent[];
  failOn?: Record<string, Error>;
}

export function createFakeAgentSystem(options: FakeAgentSystemOptions = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string, args: unknown[]) => {
    calls.push({ method, args });
    const err = options.failOn?.[method];
    if (err) throw err;
  };
  const system: AgentSystem = {
    async createSession(input) {
      record('createSession', [input]);
      const info: SessionInfo = {
        sessionId: 's-new', workspace: input.workspace, updatedAt: Date.now(),
        messageCount: 0, mode: input.teamId ? 'multi-agent' : 'single', teamId: input.teamId,
      };
      return info;
    },
    async getSession(sessionId) {
      record('getSession', [sessionId]);
      const found = options.sessions?.find((s) => s.sessionId === sessionId);
      if (!found) throw new Error(`Session not found: ${sessionId}`);
      return found;
    },
    async listSessions(workspace) {
      record('listSessions', [workspace]);
      return options.sessions ?? [];
    },
    async getSessionThreads(sessionId) {
      record('getSessionThreads', [sessionId]);
      return options.threads ?? [];
    },
    async getSessionChat(sessionId) {
      record('getSessionChat', [sessionId]);
      return options.chat ?? [];
    },
    async getAgentThreadContext(sessionId, agentThreadId) {
      record('getAgentThreadContext', [sessionId, agentThreadId]);
      return options.threadMessages ?? [];
    },
    async send(input) {
      record('send', [input]);
    },
    async interrupt(sessionId) {
      record('interrupt', [sessionId]);
    },
    async listTeams() {
      record('listTeams', []);
      return options.teams ?? [];
    },
    events(signal?) {
      record('events', [signal]);
      const all = options.events ?? [];
      return (async function* () {
        for (const event of all) {
          if (signal?.aborted) return;
          yield event;
        }
      })();
    },
  };
  return { system, calls };
}
```

注意 `Message` 类型从 `rem-agent-core` 导出（core index 已 re-export pi-ai 的 `Message`）。若 typecheck 报未导出，改为 `import type { Message } from '@earendil-works/pi-ai'` 并在 package.json devDependencies 加 `@earendil-works/pi-ai`。

- [ ] **Step 2: 写失败测试**

`packages/web/tests/server-routes.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { SessionInfo, TeamInfo } from 'rem-agent-core';
import { createWebApp } from '../src/server/app.js';
import { createFakeAgentSystem } from './helpers/fake-agent-system.js';

const session: SessionInfo = {
  sessionId: 's1', workspace: '/ws', title: 'demo', updatedAt: 1, messageCount: 2, mode: 'single',
};
const team: TeamInfo = { id: 'research', organizer: 'lead', members: ['a', 'b'] };

function setup(options: Parameters<typeof createFakeAgentSystem>[0] = {}) {
  const fake = createFakeAgentSystem(options);
  const app = createWebApp({ system: fake.system, workspace: '/ws' });
  return { app, fake };
}

describe('sessions routes', () => {
  it('GET /api/rem/sessions 返回列表并传入 workspace', async () => {
    const { app, fake } = setup({ sessions: [session] });
    const res = await app.request('/api/rem/sessions');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([session]);
    expect(fake.calls[0]).toEqual({ method: 'listSessions', args: ['/ws'] });
  });

  it('POST /api/rem/sessions 带 teamId 创建多 Agent session', async () => {
    const { app, fake } = setup();
    const res = await app.request('/api/rem/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 'research' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mode).toBe('multi-agent');
    expect(fake.calls[0]).toEqual({
      method: 'createSession',
      args: [{ workspace: '/ws', teamId: 'research' }],
    });
  });

  it('Core 抛 not found 错误时返回 404', async () => {
    const { app } = setup({ failOn: { listSessions: new Error('Session not found: x') } });
    const res = await app.request('/api/rem/sessions');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('not found');
  });
});

describe('teams route', () => {
  it('GET /api/rem/teams 返回 team 列表', async () => {
    const { app } = setup({ teams: [team] });
    const res = await app.request('/api/rem/teams');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([team]);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter rem-agent-web test`
Expected: FAIL，`Cannot find module '../src/server/app.js'`

- [ ] **Step 4: 实现 errors.ts**

`packages/web/src/server/errors.ts`：

```typescript
import type { Context } from 'hono';

const NOT_FOUND_PATTERN = /not found|unknown|does not belong/i;
const CONFLICT_PATTERN = /already running/i;

export function toErrorResponse(err: unknown, c: Context): Response {
  const message = err instanceof Error ? err.message : String(err);
  const status = NOT_FOUND_PATTERN.test(message) ? 404 : CONFLICT_PATTERN.test(message) ? 409 : 500;
  return c.json({ error: message }, status as 404 | 409 | 500);
}
```

- [ ] **Step 5: 实现 routes/sessions.ts 与 routes/teams.ts**

`packages/web/src/server/routes/sessions.ts`：

```typescript
import { Hono } from 'hono';
import type { WebAppDeps } from '../app.js';

export function sessionsRoutes(deps: WebAppDeps): Hono {
  const r = new Hono();

  r.get('/', async (c) => c.json(await deps.system.listSessions(deps.workspace)));

  r.post('/', async (c) => {
    const body = (await c.req.json<{ teamId?: string }>().catch(() => ({}))) ?? {};
    const info = await deps.system.createSession({ workspace: deps.workspace, teamId: body.teamId });
    return c.json(info, 201);
  });

  r.get('/:id/chat', async (c) => c.json(await deps.system.getSessionChat(c.req.param('id'))));

  r.get('/:id/threads', async (c) => c.json(await deps.system.getSessionThreads(c.req.param('id'))));

  r.get('/:id/threads/:tid/messages', async (c) =>
    c.json(await deps.system.getAgentThreadContext(c.req.param('id'), c.req.param('tid'))));

  r.post('/:id/send', async (c) => {
    const body = await c.req.json<{ content?: string }>().catch(() => null);
    if (!body || typeof body.content !== 'string' || body.content.trim() === '') {
      return c.json({ error: 'content must be a non-empty string' }, 400);
    }
    await deps.system.send({ sessionId: c.req.param('id'), content: body.content });
    return c.body(null, 204);
  });

  r.post('/:id/interrupt', async (c) => {
    await deps.system.interrupt(c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
```

`packages/web/src/server/routes/teams.ts`：

```typescript
import { Hono } from 'hono';
import type { WebAppDeps } from '../app.js';

export function teamsRoutes(deps: WebAppDeps): Hono {
  const r = new Hono();
  r.get('/', async (c) => c.json(await deps.system.listTeams()));
  return r;
}
```

- [ ] **Step 6: 实现 app.ts**

`packages/web/src/server/app.ts`：

```typescript
import { Hono } from 'hono';
import type { AgentSystem } from 'rem-agent-core';
import { toErrorResponse } from './errors.js';
import { sessionsRoutes } from './routes/sessions.js';
import { teamsRoutes } from './routes/teams.js';

export interface WebAppDeps {
  system: AgentSystem;
  workspace: string;
}

export function createWebApp(deps: WebAppDeps): Hono {
  const app = new Hono();
  app.onError((err, c) => toErrorResponse(err, c));
  app.route('/api/rem/sessions', sessionsRoutes(deps));
  app.route('/api/rem/teams', teamsRoutes(deps));
  return app;
}
```

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter rem-agent-web test && pnpm --filter rem-agent-web typecheck`
Expected: PASS（vitest alias 已把 `rem-agent-core` 指到 core src，无需先构建 core）

- [ ] **Step 8: Commit**

```bash
git add packages/web
git commit -m "feat(web): add sessions/teams REST routes with error mapping"
```

---

## Task 7: server — SSE stream 路由

**Files:**
- Create: `packages/web/src/server/routes/stream.ts`
- Modify: `packages/web/src/server/app.ts`
- Test: `packages/web/tests/server-stream.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/web/tests/server-stream.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { AgentSystemEvent } from 'rem-agent-core';
import { createWebApp } from '../src/server/app.js';
import { createFakeAgentSystem } from './helpers/fake-agent-system.js';

const events: AgentSystemEvent[] = [
  { workspace: '/ws', sessionId: 's1', type: 'session-start' },
  { workspace: '/ws', sessionId: 's1', type: 'activity-change', activity: 'thinking' },
];

it('GET /api/rem/stream 以 event: bus 格式推送全部系统事件', async () => {
  const fake = createFakeAgentSystem({ events });
  const app = createWebApp({ system: fake.system, workspace: '/ws' });
  const res = await app.request('/api/rem/stream');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const text = await res.text();
  const frames = text.split('\n\n').filter((f) => f.startsWith('event: bus'));
  expect(frames).toHaveLength(2);
  expect(frames[0]).toContain('"type":"session-start"');
  expect(frames[1]).toContain('"type":"activity-change"');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter rem-agent-web test -- server-stream`
Expected: FAIL（404）

- [ ] **Step 3: 实现 routes/stream.ts**

```typescript
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { WebAppDeps } from '../app.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

export function streamRoutes(deps: WebAppDeps): Hono {
  const r = new Hono();

  r.get('/', (c: Context) => {
    const signal = c.req.raw.signal;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            /* 连接已关闭 */
          }
        }, 15_000);
        try {
          for await (const event of deps.system.events(signal)) {
            controller.enqueue(encoder.encode(`event: bus\ndata: ${JSON.stringify(event)}\n\n`));
            if (signal.aborted) break;
          }
        } catch {
          /* 客户端断开或 system 事件流结束 */
        } finally {
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            /* 已关闭 */
          }
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  });

  return r;
}
```

- [ ] **Step 4: 挂载到 app.ts**

`packages/web/src/server/app.ts`，import 区加 `import { streamRoutes } from './routes/stream.js';`，`teamsRoutes` 挂载行后加：

```typescript
  app.route('/api/rem/stream', streamRoutes(deps));
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter rem-agent-web test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): add SSE stream route for AgentSystemEvent"
```

---

## Task 8: server — CLI 入口 + 生产静态文件

**Files:**
- Create: `packages/web/src/server/index.ts`

- [ ] **Step 1: 实现 index.ts**

```typescript
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createAgentFromEnv, createAgentSystem } from 'rem-agent-core';
import { createWebApp } from './app.js';

function parseArgs(argv: string[]): { workspace: string; port?: number } {
  const args = { workspace: process.cwd(), port: undefined as number | undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--workspace') args.workspace = path.resolve(argv[++i]);
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
  }
  return args;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wsStat = await stat(args.workspace).catch(() => null);
  if (!wsStat?.isDirectory()) {
    console.error(`Workspace 目录不存在: ${args.workspace}`);
    process.exit(1);
  }

  const assembly = await createAgentFromEnv().catch((err: unknown) => {
    console.error(`Core 装配失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
  const system = createAgentSystem(assembly!);
  const app = createWebApp({ system, workspace: args.workspace });

  const isProduction = process.env.NODE_ENV === 'production';
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  if (isProduction) {
    const staticRoot = path.resolve(dirname, '../client');
    const { readFile } = await import('node:fs/promises');
    app.get('*', async (c) => {
      const reqPath = c.req.path.endsWith('/') ? `${c.req.path}index.html` : c.req.path;
      const filePath = path.join(staticRoot, reqPath);
      const fileStat = await stat(filePath).catch(() => null);
      if (fileStat?.isFile()) {
        const content = await readFile(filePath);
        const type = MIME[path.extname(filePath)] ?? 'application/octet-stream';
        return new Response(content, { headers: { 'Content-Type': type } });
      }
      return c.html(await readFile(path.join(staticRoot, 'index.html'), 'utf-8'));
    });
  }

  const port = args.port ?? (isProduction ? 3000 : 3001);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Rem Web listening at http://localhost:${info.port} (workspace: ${args.workspace})`);
  });
}

await main();
```

- [ ] **Step 2: 验证 typecheck + 构建顺序**

Run: `pnpm build`
Expected: core 构建成功后 web 的 `tsc -p tsconfig.server.json` 与 `vite build` 通过（vite build 此时 client 只有占位 main.tsx，能通过）

- [ ] **Step 3: Commit**

```bash
git add packages/web
git commit -m "feat(web): add server CLI entry with static serving"
```

---

## Task 9: client — REST api client

**Files:**
- Create: `packages/web/src/client/api/client.ts`
- Test: `packages/web/tests/api-client.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/web/tests/api-client.test.ts`：

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api client', () => {
  it('listSessions 请求 /api/rem/sessions', async () => {
    const fn = stubFetch(200, []);
    await api.listSessions();
    expect(fn).toHaveBeenCalledWith('/api/rem/sessions', undefined);
  });

  it('createSession 带 teamId POST', async () => {
    const fn = stubFetch(201, { sessionId: 's1' });
    await api.createSession('research');
    expect(fn).toHaveBeenCalledWith('/api/rem/sessions', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ teamId: 'research' });
  });

  it('sendMessage 发送 content', async () => {
    const fn = stubFetch(204);
    await api.sendMessage('s1', 'hello');
    expect(fn).toHaveBeenCalledWith('/api/rem/sessions/s1/send', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ content: 'hello' });
  });

  it('非 2xx 抛出带 error 信息的异常', async () => {
    stubFetch(404, { error: 'Session not found: x' });
    await expect(api.getChat('x')).rejects.toThrow('Session not found: x');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter rem-agent-web test -- api-client`
Expected: FAIL，`Cannot find module '@/api/client'`

- [ ] **Step 3: 实现 api/client.ts**

```typescript
import type {
  AgentThread, Message, SessionChatMessage, SessionInfo, TeamInfo,
} from 'rem-agent-core';

const BASE = '/api/rem';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* 非 JSON 错误响应 */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function post(path: string, body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  };
}

export const api = {
  listSessions: () => request<SessionInfo[]>('/sessions'),
  createSession: (teamId?: string) =>
    request<SessionInfo>('/sessions', post(teamId ? { teamId } : {})),
  getChat: (sessionId: string) =>
    request<SessionChatMessage[]>(`/sessions/${sessionId}/chat`),
  getThreads: (sessionId: string) =>
    request<AgentThread[]>(`/sessions/${sessionId}/threads`),
  getThreadMessages: (sessionId: string, threadId: string) =>
    request<Message[]>(`/sessions/${sessionId}/threads/${threadId}/messages`),
  sendMessage: (sessionId: string, content: string) =>
    request<void>(`/sessions/${sessionId}/send`, post({ content })),
  interrupt: (sessionId: string) => request<void>(`/sessions/${sessionId}/interrupt`, post()),
  listTeams: () => request<TeamInfo[]>('/teams'),
};
```

注意：client 对 `rem-agent-core` 只用 `import type`（运行时零依赖），本文件所有导入保持 type-only。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter rem-agent-web test -- api-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): add client REST api wrapper"
```

---

## Task 10: client — SSE 解析 + event bus（重连）

**Files:**
- Create: `packages/web/src/client/api/sse.ts`
- Create: `packages/web/src/client/api/bus.ts`
- Test: `packages/web/tests/bus.test.ts`

- [ ] **Step 1: 移植 sse.ts（从 archive 拷贝后改类型）**

```bash
cp archive/bridge/src/sse.ts packages/web/src/client/api/sse.ts
```

然后编辑 `packages/web/src/client/api/sse.ts`：
- 第 1 行 import 改为 `import type { AgentSystemEvent } from 'rem-agent-core';`
- `parseAgentStreamEvent` 改名为 `parseBusEvent`，返回类型 `AgentSystemEvent`；catch 分支返回 `null` 而不是构造 error 事件，签名改为 `parseBusEvent(data: string): AgentSystemEvent | null`：

```typescript
export function parseBusEvent(data: string): AgentSystemEvent | null {
  try {
    return JSON.parse(data) as AgentSystemEvent;
  } catch {
    return null;
  }
}
```

- `parseSSEStream` 函数体保持不变。

- [ ] **Step 2: 写 bus 失败测试**

`packages/web/tests/bus.test.ts`：

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startEventBus } from '@/api/bus';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function sseResponse(frames: string[]): Response {
  const text = frames.map((f) => `event: bus\ndata: ${f}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('startEventBus', () => {
  it('解析 event: bus 帧并分发事件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse(['{"workspace":"/w","sessionId":"s1","type":"session-start"}'])));
    const received: unknown[] = [];
    const stop = startEventBus({
      onEvent: (ev) => received.push(ev),
      onReconnect: () => {},
    });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ type: 'session-start', sessionId: 's1' });
    stop();
  });

  it('连接失败后指数退避重连，成功时触发 onReconnect', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network down');
      return sseResponse([]);
    }));
    const onReconnect = vi.fn();
    const stop = startEventBus({ onEvent: () => {}, onReconnect });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempt).toBe(2);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    stop();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter rem-agent-web test -- bus`
Expected: FAIL

- [ ] **Step 4: 实现 api/bus.ts**

```typescript
import type { AgentSystemEvent } from 'rem-agent-core';
import { parseBusEvent, parseSSEStream } from './sse';

export interface EventBusHandlers {
  onEvent: (event: AgentSystemEvent) => void;
  onReconnect: () => void;
}

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 15_000;

/** 启动 SSE 单例连接；返回停止函数。断线指数退避重连（1s → 15s），重连成功回调 onReconnect。 */
export function startEventBus(handlers: EventBusHandlers): () => void {
  let stopped = false;
  let delay = INITIAL_DELAY_MS;
  let everConnected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = async (): Promise<void> => {
    while (!stopped) {
      try {
        const res = await fetch('/api/rem/stream');
        if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
        if (everConnected) handlers.onReconnect();
        everConnected = true;
        delay = INITIAL_DELAY_MS;
        for await (const frame of parseSSEStream(res.body.getReader())) {
          if (stopped) return;
          if (frame.event !== 'bus') continue;
          const event = parseBusEvent(frame.data);
          if (event) handlers.onEvent(event);
        }
        throw new Error('SSE stream ended');
      } catch {
        if (stopped) return;
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, delay);
        });
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      }
    }
  };

  void connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter rem-agent-web test -- bus`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): add SSE event bus with backoff reconnect"
```

---

## Task 11: client — stream-reducer（chunk → ContentBlock[]）

**Files:**
- Create: `packages/web/src/client/state/stream-reducer.ts`
- Test: `packages/web/tests/stream-reducer.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/web/tests/stream-reducer.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { reduceStreamEvent, type ContentBlock } from '@/state/stream-reducer';

describe('reduceStreamEvent', () => {
  it('text_start + text_delta 累积文本', () => {
    let parts: ContentBlock[] = [];
    parts = reduceStreamEvent(parts, { type: 'text_start', contentIndex: 0 } as never);
    parts = reduceStreamEvent(parts, { type: 'text_delta', contentIndex: 0, delta: 'he' } as never);
    parts = reduceStreamEvent(parts, { type: 'text_delta', contentIndex: 0, delta: 'llo' } as never);
    expect(parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('thinking_delta 累积思考内容', () => {
    let parts: ContentBlock[] = [];
    parts = reduceStreamEvent(parts, { type: 'thinking_start', contentIndex: 1 } as never);
    parts = reduceStreamEvent(parts, { type: 'thinking_delta', contentIndex: 1, delta: 'hmm' } as never);
    expect(parts[1]).toEqual({ type: 'thinking', thinking: 'hmm' });
  });

  it('toolcall_end 落定完整 ToolCall', () => {
    const toolCall = { type: 'toolCall', id: 't1', name: 'bash', arguments: { cmd: 'ls' } };
    const parts = reduceStreamEvent([], { type: 'toolcall_end', contentIndex: 0, toolCall } as never);
    expect(parts[0]).toEqual(toolCall);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter rem-agent-web test -- stream-reducer`
Expected: FAIL

- [ ] **Step 3: 实现 stream-reducer.ts**

```typescript
import type { AssistantMessageEvent, ToolCall } from 'rem-agent-core';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | ToolCall;

/** 把 pi-ai 增量事件折叠为 UI 内容块。移植自 archive/bridge stream-reducer，输出改用本地 ContentBlock。 */
export function reduceStreamEvent(parts: ContentBlock[], event: AssistantMessageEvent): ContentBlock[] {
  const next = [...parts];
  switch (event.type) {
    case 'text_start':
      next[event.contentIndex] = { type: 'text', text: '' };
      break;
    case 'text_delta': {
      const existing = next[event.contentIndex];
      next[event.contentIndex] = existing?.type === 'text'
        ? { type: 'text', text: existing.text + event.delta }
        : { type: 'text', text: event.delta };
      break;
    }
    case 'thinking_start':
      next[event.contentIndex] = { type: 'thinking', thinking: '' };
      break;
    case 'thinking_delta': {
      const existing = next[event.contentIndex];
      next[event.contentIndex] = existing?.type === 'thinking'
        ? { type: 'thinking', thinking: existing.thinking + event.delta }
        : { type: 'thinking', thinking: event.delta };
      break;
    }
    case 'toolcall_start':
    case 'toolcall_delta': {
      const partial = event.partial.content[event.contentIndex];
      if (partial?.type === 'toolCall') next[event.contentIndex] = partial;
      break;
    }
    case 'toolcall_end':
      next[event.contentIndex] = event.toolCall;
      break;
    default:
      break;
  }
  return next;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter rem-agent-web test -- stream-reducer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): add stream reducer for assistant chunk events"
```

---

## Task 12: client — stream-store（zustand 状态层，核心）

**Files:**
- Create: `packages/web/src/client/state/stream-store.ts`
- Test: `packages/web/tests/stream-store.test.ts`

设计要点：
- `streaming` 以 `agentThreadId` 为 key 累积 `ContentBlock[]`
- chunk 中的 `message_update` 提取 `assistantMessageEvent` 走 reducer；`message_end` / `finish` / `session-end` 清空对应 streaming 并 bump `chatVersion` / `threadVersions`，组件 effect 监听 version 变化后 refetch
- `activity-change` 更新 sessions 列表中对应项的 activity
- `session-error` 写入 session 级 error

- [ ] **Step 1: 写失败测试**

`packages/web/tests/stream-store.test.ts`：

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentSystemEvent } from 'rem-agent-core';
import { useStreamStore } from '@/state/stream-store';

beforeEach(() => useStreamStore.getState().reset());

const chunk = (over: Record<string, unknown>): AgentSystemEvent => ({
  workspace: '/w', sessionId: 's1', type: 'chunk', agentThreadId: 'th1', ...over,
}) as AgentSystemEvent;

describe('stream-store', () => {
  it('message_update chunk 归并到对应 thread 的 streaming', () => {
    const store = useStreamStore.getState();
    store.applyEvent(chunk({
      chunk: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hi' },
      },
    }));
    expect(useStreamStore.getState().bySession.s1.streaming.th1)
      .toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('message_end 清空 streaming 并 bump threadVersion', () => {
    const store = useStreamStore.getState();
    store.applyEvent(chunk({
      chunk: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hi' },
      },
    }));
    store.applyEvent(chunk({ chunk: { type: 'message_end' } }));
    const state = useStreamStore.getState().bySession.s1;
    expect(state.streaming.th1).toBeUndefined();
    expect(state.threadVersions.th1).toBe(1);
    expect(state.chatVersion).toBe(1);
  });

  it('activity-change 更新 session 列表中的 activity', () => {
    const store = useStreamStore.getState();
    store.setSessions([{
      sessionId: 's1', workspace: '/w', updatedAt: 1, messageCount: 0, mode: 'single',
    }]);
    store.applyEvent({
      workspace: '/w', sessionId: 's1', type: 'activity-change', activity: 'thinking',
    });
    expect(useStreamStore.getState().sessions[0].activity).toBe('thinking');
  });

  it('session-error 记录到 session 级 error', () => {
    useStreamStore.getState().applyEvent({
      workspace: '/w', sessionId: 's1', type: 'session-error', error: 'boom',
    });
    expect(useStreamStore.getState().bySession.s1.error).toBe('boom');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter rem-agent-web test -- stream-store`
Expected: FAIL

- [ ] **Step 3: 实现 stream-store.ts**

```typescript
import { create } from 'zustand';
import type {
  AgentSystemEvent, AgentThread, Message, SessionChatMessage, SessionInfo,
} from 'rem-agent-core';
import { reduceStreamEvent, type ContentBlock } from './stream-reducer';

export interface SessionState {
  chat: SessionChatMessage[];
  threads: AgentThread[];
  threadMessages: Record<string, Message[]>;
  streaming: Record<string, ContentBlock[]>;
  chatVersion: number;
  threadVersions: Record<string, number>;
  error?: string;
}

interface StreamStore {
  sessions: SessionInfo[];
  bySession: Record<string, SessionState>;
  setSessions: (sessions: SessionInfo[]) => void;
  setChat: (sessionId: string, chat: SessionChatMessage[]) => void;
  setThreads: (sessionId: string, threads: AgentThread[]) => void;
  setThreadMessages: (threadKey: { sessionId: string; threadId: string }, messages: Message[]) => void;
  applyEvent: (event: AgentSystemEvent) => void;
  reset: () => void;
}

const emptySessionState = (): SessionState => ({
  chat: [],
  threads: [],
  threadMessages: {},
  streaming: {},
  chatVersion: 0,
  threadVersions: {},
});

export const useStreamStore = create<StreamStore>((set) => {
  const patchSession = (sessionId: string, patch: (s: SessionState) => Partial<SessionState>) =>
    set((state) => {
      const current = state.bySession[sessionId] ?? emptySessionState();
      return { bySession: { ...state.bySession, [sessionId]: { ...current, ...patch(current) } } };
    });

  return {
    sessions: [],
    bySession: {},
    setSessions: (sessions) => set({ sessions }),
    setChat: (sessionId, chat) => patchSession(sessionId, () => ({ chat })),
    setThreads: (sessionId, threads) => patchSession(sessionId, () => ({ threads })),
    setThreadMessages: ({ sessionId, threadId }, messages) =>
      patchSession(sessionId, (s) => ({
        threadMessages: { ...s.threadMessages, [threadId]: messages },
      })),
    applyEvent: (event) => {
      switch (event.type) {
        case 'chunk': {
          const threadId = event.agentThreadId ?? 'primary';
          const chunk = event.chunk;
          if (chunk.type === 'message_update') {
            patchSession(event.sessionId, (s) => ({
              streaming: {
                ...s.streaming,
                [threadId]: reduceStreamEvent(
                  s.streaming[threadId] ?? [],
                  chunk.assistantMessageEvent,
                ),
              },
            }));
          } else if (chunk.type === 'message_end' || chunk.type === 'finish') {
            patchSession(event.sessionId, (s) => {
              const streaming = { ...s.streaming };
              delete streaming[threadId];
              return {
                streaming,
                chatVersion: s.chatVersion + 1,
                threadVersions: {
                  ...s.threadVersions,
                  [threadId]: (s.threadVersions[threadId] ?? 0) + 1,
                },
              };
            });
          }
          break;
        }
        case 'activity-change':
          set((state) => ({
            sessions: state.sessions.map((s) =>
              s.sessionId === event.sessionId ? { ...s, activity: event.activity } : s),
          }));
          break;
        case 'session-end':
          patchSession(event.sessionId, (s) => ({ chatVersion: s.chatVersion + 1 }));
          break;
        case 'session-error':
          patchSession(event.sessionId, () => ({ error: event.error }));
          break;
        default:
          break;
      }
    },
    reset: () => set({ sessions: [], bySession: {} }),
  };
});
```

- [ ] **Step 4: 运行确认通过 + typecheck**

Run: `pnpm --filter rem-agent-web test -- stream-store && pnpm --filter rem-agent-web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): add zustand stream store with event routing"
```

---

## Task 13: client — 渲染组件搬运（markdown / tool-call / reasoning）

**Files:**
- Create: `packages/web/src/client/lib/markdown.ts`（拷贝）
- Create: `packages/web/src/client/components/markdown-content.tsx`（拷贝适配）
- Create: `packages/web/src/client/components/tool-call-block.tsx`（拷贝精简）
- Create: `packages/web/src/client/components/reasoning-block.tsx`（拷贝适配）

- [ ] **Step 1: 拷贝 markdown lib 与渲染组件**

```bash
cp archive/ui/src/lib/markdown.ts packages/web/src/client/lib/markdown.ts
cp archive/ui/src/components/chat/markdown-content.tsx packages/web/src/client/components/markdown-content.tsx
cp archive/ui/src/components/chat/reasoning-block.tsx packages/web/src/client/components/reasoning-block.tsx
```

- [ ] **Step 2: 适配 import 与主题变量**

`markdown-content.tsx`：
- `import { renderMarkdown } from '../../lib/markdown.js'` → `import { renderMarkdown } from '@/lib/markdown';`
- `addCopyButtons` 中的 `var(--color-card)` / `var(--color-tx3)` / `var(--color-bd)` 分别替换为 `var(--card)` / `var(--muted-foreground)` / `var(--border)`

`reasoning-block.tsx`：
- 检查其 import：若有 `../../lib/utils.js` → `@/lib/utils`；Tailwind 类里的自定义色（`text-tx3`、`bg-card2` 等）替换为 shadcn 语义类（`text-muted-foreground`、`bg-muted`、`border-border`、`text-foreground`）。逐个类对照替换，保持布局类不变。

`markdown.ts`：无需改动（只用 marked/shiki）。确认 `THEME = 'github-dark'` 与暗色主题匹配，保留。

- [ ] **Step 3: tool-call-block.tsx 精简重写**

archive 版本耦合 `ToolResultBlock`（bridge 类型）与 `ChildAgentCard`，按新类型精简。完整写入 `packages/web/src/client/components/tool-call-block.tsx`：

```tsx
import { useState } from 'react';
import { ChevronRight, Wrench, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCall } from 'rem-agent-core';

export interface ToolResultInfo {
  output?: string;
  error?: string;
}

interface ToolCallBlockProps {
  tool: ToolCall;
  result?: ToolResultInfo;
}

export function ToolCallBlock({ tool, result }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const isError = !!result?.error;
  const isExecuting = !result;

  const statusIcon = isExecuting
    ? <Loader2 size={14} className="animate-spin text-muted-foreground" />
    : isError
      ? <XCircle size={14} className="text-destructive" />
      : <CheckCircle2 size={14} className="text-emerald-400" />;

  const statusText = isExecuting ? '执行中…' : isError ? '执行失败' : (result?.output?.slice(0, 60) ?? '完成');

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors',
          isError ? 'bg-destructive/20 text-destructive'
            : isExecuting ? 'bg-muted text-muted-foreground'
              : 'bg-emerald-500/10 text-emerald-400',
        )}
      >
        <ChevronRight size={12} className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <Wrench size={12} className="shrink-0" />
        <span className="truncate font-mono">{tool.name}</span>
        {statusIcon}
        <span className="flex-1 truncate text-muted-foreground">{statusText}</span>
      </button>
      {open && (
        <div className="mx-2 mt-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs">
          <div className="mb-1 font-medium text-muted-foreground">入参</div>
          <pre className="max-h-24 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-foreground">
            {JSON.stringify(tool.arguments, null, 2) || '{}'}
          </pre>
          {result && (
            <>
              <div className="mb-1 mt-2 font-medium text-muted-foreground">
                {isError ? '错误' : '出参'}
              </div>
              <pre className={cn(
                'max-h-32 overflow-x-auto whitespace-pre-wrap font-mono text-xs',
                isError ? 'text-destructive' : 'text-foreground',
              )}>
                {isError ? result.error : result.output}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 验证**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): port markdown/tool-call/reasoning render components"
```

---

## Task 14: client — 布局壳（top-bar / status-bar / app 骨架）

**Files:**
- Create: `packages/web/src/client/components/top-bar.tsx`
- Create: `packages/web/src/client/components/status-bar.tsx`
- Modify: `packages/web/src/client/app.tsx`（新建，替换 main.tsx 占位）
- Modify: `packages/web/src/client/main.tsx`

- [ ] **Step 1: top-bar.tsx**

```tsx
import { Square, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SessionInfo } from 'rem-agent-core';

interface TopBarProps {
  session?: SessionInfo;
  running: boolean;
  onInterrupt: () => void;
  onNewSession: () => void;
}

export function TopBar({ session, running, onInterrupt, onNewSession }: TopBarProps) {
  return (
    <header className="flex h-11 items-center border-b border-border bg-card px-3">
      <span className="border-r border-border pr-3 text-[10px] font-extrabold tracking-[0.16em] text-muted-foreground">
        REM
      </span>
      <div className="ml-3 flex items-center gap-2 text-xs">
        <span className="font-medium">{session?.title ?? session?.sessionId ?? '未选择 Session'}</span>
        {session && (
          <Badge variant={session.mode === 'multi-agent' ? 'default' : 'outline'}>
            {session.mode === 'multi-agent' ? 'multi-agent' : 'single'}
          </Badge>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {running && session && (
          <Button variant="secondary" size="sm" onClick={onInterrupt}>
            <Square data-icon="inline-start" />
            中断
          </Button>
        )}
        <Button size="sm" onClick={onNewSession}>
          <Plus data-icon="inline-start" />
          Session
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: status-bar.tsx**

```tsx
import { useEffect, useState } from 'react';
import type { SessionInfo } from 'rem-agent-core';

interface StatusBarProps {
  workspace?: string;
  session?: SessionInfo;
  threadCount: number;
  runningThreads: number;
}

export function StatusBar({ workspace, session, threadCount, runningThreads }: StatusBarProps) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const update = () => setConnected(true);
    window.addEventListener('rem:sse-connected', update);
    return () => window.removeEventListener('rem:sse-connected', update);
  }, []);
  return (
    <footer className="flex h-6 items-center gap-4 border-t border-border bg-card px-3 text-[10px] text-muted-foreground">
      {workspace && <span className="truncate">workspace: {workspace}</span>}
      {session && <span>session: {session.title ?? session.sessionId}</span>}
      {threadCount > 0 && <span>threads: {threadCount} · {runningThreads} 运行中</span>}
      <span className="ml-auto">{connected ? 'SSE 已连接' : 'SSE 连接中…'}</span>
    </footer>
  );
}
```

（bus 连接/重连成功时 `window.dispatchEvent(new Event('rem:sse-connected'))`；在 Task 17 的 app 接线处补上 dispatch，或直接在 bus.ts 的 `everConnected = true` 后加一行 `if (typeof window !== 'undefined') window.dispatchEvent(new Event('rem:sse-connected'))`。选后者，本任务直接在 bus.ts 补上该行并更新 Task 10 测试不受影响。）

- [ ] **Step 3: app.tsx 布局骨架（先放空面板，后续任务填充）**

```tsx
import { useState } from 'react';
import { TopBar } from '@/components/top-bar';
import { StatusBar } from '@/components/status-bar';

export function App() {
  const [sessionId, setSessionId] = useState<string>();
  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto]">
      <TopBar
        session={undefined}
        running={false}
        onInterrupt={() => {}}
        onNewSession={() => {}}
      />
      <div className="grid min-h-0 grid-cols-[220px_1fr_auto]">
        <aside className="border-r border-border bg-card" data-slot="session-list" />
        <main className="min-w-0" data-slot="chat-view" />
        <aside className="border-l border-border bg-card" data-slot="thread-panel" />
      </div>
      <StatusBar threadCount={0} runningThreads={0} />
    </div>
  );
}
```

`main.tsx` 改为：

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 4: 验证**

Run: `pnpm --filter rem-agent-web typecheck && pnpm --filter rem-agent-web exec vite build`
Expected: PASS，构建成功

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): add app shell with top bar and status bar"
```

---

## Task 15: client — session-list + 新建 session 对话框

**Files:**
- Create: `packages/web/src/client/components/session-list.tsx`
- Create: `packages/web/src/client/components/new-session-dialog.tsx`

- [ ] **Step 1: session-list.tsx**

```tsx
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { SessionInfo } from 'rem-agent-core';

interface SessionListProps {
  sessions: SessionInfo[];
  currentId?: string;
  onSelect: (sessionId: string) => void;
}

export function SessionList({ sessions, currentId, onSelect }: SessionListProps) {
  return (
    <div className="flex h-full flex-col p-2">
      <div className="mx-1 mb-2 mt-1 text-[9px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
        Sessions
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 pr-1">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => onSelect(s.sessionId)}
              className={cn(
                'flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs hover:bg-muted',
                s.sessionId === currentId && 'border-primary/60 bg-accent',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.title ?? s.sessionId}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {s.activity && s.activity !== 'idle' ? s.activity : `${s.messageCount} 条消息`}
                </span>
              </span>
              <Badge variant={s.mode === 'multi-agent' ? 'default' : 'outline'} className="text-[9px]">
                {s.mode === 'multi-agent' ? 'multi' : 'single'}
              </Badge>
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              还没有 Session，点右上角新建
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: new-session-dialog.tsx**

```tsx
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';
import type { TeamInfo } from 'rem-agent-core';

const SINGLE = '__single__';

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (sessionId: string) => void;
}

export function NewSessionDialog({ open, onOpenChange, onCreated }: NewSessionDialogProps) {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [teamId, setTeamId] = useState(SINGLE);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) void api.listTeams().then(setTeams).catch((e: Error) => setError(e.message));
  }, [open]);

  const create = async () => {
    setCreating(true);
    setError(undefined);
    try {
      const info = await api.createSession(teamId === SINGLE ? undefined : teamId);
      onOpenChange(false);
      onCreated(info.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建 Session</DialogTitle>
        </DialogHeader>
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger>
            <SelectValue placeholder="选择类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={SINGLE}>单 Agent</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  Team: {t.id}（{t.organizer} + {t.members.length} 成员）
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button onClick={create} disabled={creating}>
            {creating ? '创建中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: 验证**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web
git commit -m "feat(web): add session list and new session dialog"
```

---

## Task 16: client — chat-view（中心流 + composer + message-item）

**Files:**
- Create: `packages/web/src/client/components/message-item.tsx`
- Create: `packages/web/src/client/components/composer.tsx`
- Create: `packages/web/src/client/components/chat-view.tsx`
- Test: `packages/web/tests/chat-view.test.tsx`

- [ ] **Step 1: message-item.tsx（中心流消息渲染）**

```tsx
import type { SessionChatMessage } from 'rem-agent-core';
import { MarkdownContent } from '@/components/markdown-content';
import { cn } from '@/lib/utils';

export function messageText(message: SessionChatMessage['message']): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function MessageItem({ item }: { item: SessionChatMessage }) {
  const isUser = item.message.role === 'user';
  const text = messageText(item.message);
  if (!text) return null;
  return (
    <div className={cn('max-w-[85%] text-xs leading-relaxed', isUser && 'self-end')}>
      {isUser ? (
        <div className="rounded-lg border border-primary/60 bg-accent px-3 py-2">{text}</div>
      ) : (
        <MarkdownContent text={text} className="px-1" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: composer.tsx**

```tsx
import { useState } from 'react';
import { SendHorizonal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ComposerProps {
  disabled?: boolean;
  onSend: (content: string) => void;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const submit = () => {
    const content = value.trim();
    if (!content || disabled) return;
    onSend(content);
    setValue('');
  };
  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="输入消息…（⌘+Enter 发送）"
        className="min-h-[40px] flex-1 resize-none text-xs"
        rows={2}
      />
      <Button size="sm" onClick={submit} disabled={disabled || !value.trim()}>
        <SendHorizonal data-icon="inline-start" />
        发送
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: chat-view.tsx**

```tsx
import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageItem } from '@/components/message-item';
import { Composer } from '@/components/composer';
import { MarkdownContent } from '@/components/markdown-content';
import { useStreamStore } from '@/state/stream-store';

interface ChatViewProps {
  sessionId: string;
  running: boolean;
  onSend: (content: string) => void;
}

export function ChatView({ sessionId, running, onSend }: ChatViewProps) {
  const session = useStreamStore((s) => s.bySession[sessionId]);
  const primaryThread = session?.threads.find((t) => t.role === 'primary' || t.role === 'organizer');
  const streaming = primaryThread ? session?.streaming[primaryThread.agentThreadId] : undefined;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [session?.chat.length, streaming]);

  const streamText = (streaming ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-[9px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
        中心会话
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-4">
          {(session?.chat ?? []).map((item) => <MessageItem key={item.messageId} item={item} />)}
          {streamText && <MarkdownContent text={streamText + '▌'} className="px-1 text-xs" />}
          {session?.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {session.error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <Composer disabled={running} onSend={onSend} />
    </div>
  );
}
```

- [ ] **Step 4: 组件测试 chat-view.test.tsx**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatView } from '@/components/chat-view';
import { useStreamStore } from '@/state/stream-store';

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

describe('ChatView', () => {
  it('渲染中心流消息与 streaming 增量', () => {
    useStreamStore.getState().reset();
    useStreamStore.getState().setChat('s1', [
      {
        messageId: 'm1',
        message: { role: 'user', content: '你好', timestamp: Date.now() } as never,
      },
    ]);
    useStreamStore.getState().setThreads('s1', [
      {
        agentThreadId: 'th1', sessionId: 's1', agentId: 'default',
        role: 'primary', lifecycle: 'persistent',
        createdAt: new Date(), updatedAt: new Date(),
      },
    ]);
    useStreamStore.getState().applyEvent({
      workspace: '/w', sessionId: 's1', type: 'chunk', agentThreadId: 'th1',
      chunk: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '回复中' },
      } as never,
    });
    render(<ChatView sessionId="s1" running={false} onSend={() => {}} />);
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.getByTestId('md').textContent).toContain('回复中');
  });
});
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter rem-agent-web test -- chat-view`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(web): add center chat view with composer"
```

---

## Task 17: client — thread-panel（多 Agent 面板）

**Files:**
- Create: `packages/web/src/client/components/thread-panel.tsx`
- Test: `packages/web/tests/thread-panel.test.tsx`

- [ ] **Step 1: thread-panel.tsx**

```tsx
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownContent } from '@/components/markdown-content';
import { ToolCallBlock } from '@/components/tool-call-block';
import { ReasoningBlock } from '@/components/reasoning-block';
import { cn } from '@/lib/utils';
import { useStreamStore } from '@/state/stream-store';
import type { ContentBlock } from '@/state/stream-reducer';
import type { Message } from 'rem-agent-core';

function Blocks({ parts }: { parts: ContentBlock[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') return <MarkdownContent key={i} text={part.text} className="text-xs" />;
        if (part.type === 'thinking') return <ReasoningBlock key={i} text={part.thinking} />;
        return <ToolCallBlock key={i} tool={part} />;
      })}
    </>
  );
}

function ThreadMessage({ message }: { message: Message }) {
  if (message.role === 'user') {
    const text = typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text).join('\n');
    return <div className="rounded-md bg-muted px-2.5 py-1.5 text-xs">{text}</div>;
  }
  if (message.role === 'assistant') return <Blocks parts={message.content} />;
  return null; // toolResult 等暂不渲染（最小可用版）
}

interface ThreadPanelProps {
  sessionId: string;
}

export function ThreadPanel({ sessionId }: ThreadPanelProps) {
  const session = useStreamStore((s) => s.bySession[sessionId]);
  const threads = session?.threads ?? [];
  const [selected, setSelected] = useState<string>();
  const active = threads.find((t) => t.agentThreadId === selected) ?? threads[0];

  if (threads.length === 0) return null;

  const messages = active ? session?.threadMessages[active.agentThreadId] ?? [] : [];
  const streaming = active ? session?.streaming[active.agentThreadId] : undefined;

  return (
    <div className="flex h-full w-[300px] flex-col">
      <Tabs value={active?.agentThreadId} onValueChange={setSelected}>
        <TabsList className="m-2 flex-wrap">
          {threads.map((t) => (
            <TabsTrigger key={t.agentThreadId} value={t.agentThreadId} className="text-[10px]">
              <span className={cn(
                'mr-1 inline-block size-1.5 rounded-full',
                session?.streaming[t.agentThreadId] ? 'bg-emerald-400' : 'bg-muted-foreground/40',
              )} />
              {t.agentId}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="px-3 pb-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {active?.agentId} · 私有视角
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {messages.map((m, i) => <ThreadMessage key={i} message={m} />)}
          {streaming && <Blocks parts={streaming} />}
        </div>
      </ScrollArea>
    </div>
  );
}
```

注意：ReasoningBlock 的 prop 名以 archive 实际文件为准（拷贝后查看 `archive/ui/src/components/chat/reasoning-block.tsx` 的 props 接口，若 prop 不叫 `text` 则相应调整）。

- [ ] **Step 2: 组件测试 thread-panel.test.tsx**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThreadPanel } from '@/components/thread-panel';
import { useStreamStore } from '@/state/stream-store';
import type { AgentThread } from 'rem-agent-core';

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

const thread = (id: string, agentId: string, role: AgentThread['role']): AgentThread => ({
  agentThreadId: id, sessionId: 's1', agentId, role,
  lifecycle: 'persistent', createdAt: new Date(), updatedAt: new Date(),
});

describe('ThreadPanel', () => {
  it('threads 为空时不渲染', () => {
    useStreamStore.getState().reset();
    const { container } = render(<ThreadPanel sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it('默认选中第一个 thread 并渲染其消息', () => {
    useStreamStore.getState().reset();
    useStreamStore.getState().setThreads('s1', [
      thread('th1', 'organizer', 'organizer'),
      thread('th2', 'researcher', 'member'),
    ]);
    useStreamStore.getState().setThreadMessages({ sessionId: 's1', threadId: 'th1' }, [
      { role: 'user', content: '拆解任务', timestamp: Date.now() } as never,
    ]);
    render(<ThreadPanel sessionId="s1" />);
    expect(screen.getByText('拆解任务')).toBeTruthy();
    expect(screen.getByText('researcher')).toBeTruthy();
  });
});
```

- [ ] **Step 3: 运行确认通过**

Run: `pnpm --filter rem-agent-web test -- thread-panel`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web
git commit -m "feat(web): add multi-agent thread panel"
```

---

## Task 18: client — app 接线（数据流闭环）

**Files:**
- Modify: `packages/web/src/client/app.tsx`

- [ ] **Step 1: 完整实现 app.tsx**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { startEventBus } from '@/api/bus';
import { useStreamStore } from '@/state/stream-store';
import { TopBar } from '@/components/top-bar';
import { StatusBar } from '@/components/status-bar';
import { SessionList } from '@/components/session-list';
import { NewSessionDialog } from '@/components/new-session-dialog';
import { ChatView } from '@/components/chat-view';
import { ThreadPanel } from '@/components/thread-panel';

export function App() {
  const sessions = useStreamStore((s) => s.sessions);
  const bySession = useStreamStore((s) => s.bySession);
  const [sessionId, setSessionId] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);

  const current = sessions.find((s) => s.sessionId === sessionId);
  const currentState = sessionId ? bySession[sessionId] : undefined;
  const running = current?.activity !== undefined && current.activity !== 'idle';

  const loadSession = useCallback(async (id: string) => {
    const [chat, threads] = await Promise.all([api.getChat(id), api.getThreads(id)]);
    useStreamStore.getState().setChat(id, chat);
    useStreamStore.getState().setThreads(id, threads);
    const primary = threads.find((t) => t.role === 'primary' || t.role === 'organizer');
    if (primary) {
      const messages = await api.getThreadMessages(id, primary.agentThreadId);
      useStreamStore.getState().setThreadMessages(
        { sessionId: id, threadId: primary.agentThreadId }, messages);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    useStreamStore.getState().setSessions(await api.listSessions());
  }, []);

  // 初始加载 + SSE 订阅
  useEffect(() => {
    void refreshSessions();
    return startEventBus({
      onEvent: (event) => useStreamStore.getState().applyEvent(event),
      onReconnect: () => {
        void refreshSessions();
        if (sessionId) void loadSession(sessionId);
      },
    });
  }, [refreshSessions, loadSession, sessionId]);

  // 切换 session 时加载
  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
  }, [sessionId, loadSession]);

  // message_end / session-end 后 refetch（version 驱动）
  useEffect(() => {
    if (!sessionId || !currentState) return;
    void api.getChat(sessionId).then((chat) =>
      useStreamStore.getState().setChat(sessionId, chat));
  }, [sessionId, currentState?.chatVersion]);

  useEffect(() => {
    if (!sessionId || !currentState) return;
    for (const [threadId, version] of Object.entries(currentState.threadVersions)) {
      if (version > 0) {
        void api.getThreadMessages(sessionId, threadId).then((messages) =>
          useStreamStore.getState().setThreadMessages({ sessionId, threadId }, messages));
      }
    }
  }, [sessionId, currentState?.threadVersions]);

  const send = async (content: string) => {
    if (!sessionId) return;
    await api.sendMessage(sessionId, content);
    // 乐观更新中心流（用户消息）
    const chat = await api.getChat(sessionId);
    useStreamStore.getState().setChat(sessionId, chat);
  };

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto]">
      <TopBar
        session={current}
        running={running}
        onInterrupt={() => sessionId && void api.interrupt(sessionId)}
        onNewSession={() => setDialogOpen(true)}
      />
      <div className="grid min-h-0 grid-cols-[220px_1fr_auto]">
        <aside className="border-r border-border bg-card">
          <SessionList sessions={sessions} currentId={sessionId} onSelect={setSessionId} />
        </aside>
        <main className="min-w-0 bg-background">
          {sessionId ? (
            <ChatView sessionId={sessionId} running={running} onSend={(c) => void send(c)} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              选择或新建一个 Session 开始
            </div>
          )}
        </main>
        {sessionId && current?.mode === 'multi-agent' && (
          <aside className="border-l border-border bg-card">
            <ThreadPanel sessionId={sessionId} />
          </aside>
        )}
      </div>
      <StatusBar
        session={current}
        threadCount={currentState?.threads.length ?? 0}
        runningThreads={Object.keys(currentState?.streaming ?? {}).length}
      />
    </div>
  );
}
```

（sessionId 变化引起的 effect 依赖 lint 警告可接受；最小可用版不引入更复杂的数据获取层。）

- [ ] **Step 2: 验证**

Run: `pnpm --filter rem-agent-web typecheck && pnpm --filter rem-agent-web test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web
git commit -m "feat(web): wire app data flow with SSE event bus"
```

---

## Task 19: 总验证 + 手动 smoke

- [ ] **Step 1: 全套检查**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`
Expected: 全绿，无新增结构违规

- [ ] **Step 2: 手动 smoke（需要真实 LLM API key 的环境变量）**

```bash
pnpm dev:web   # 另一个终端打开 http://localhost:3000
```

检查清单：
1. 右上角「＋ Session」新建单 Agent session → 发消息 → 流式渲染 → 中断按钮可用
2. 若 Core 配置里定义了 team：新建多 Agent session → 中心流只出现公开消息 → 右侧 thread 面板可切换各 Agent 私有视角（含 tool call 块）
3. 刷新页面后 session 列表与消息完整恢复
4. 断网再恢复（DevTools offline 切换）→ SSE 重连后消息不丢

- [ ] **Step 3: 更新文档**

在 `docs/architecture.md` 的「活动边界」处补一行：`packages/web` 是新的接入层 + UI（Hono + React），只依赖 Core 的 `AgentSystem` 门面。commit message: `docs: note packages/web as the active adapter layer`

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md packages/web
git commit -m "chore(web): finalize minimal web UI"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec 第 3 节 API 表 → Task 6/7 全覆盖（sessions CRUD 子集、chat、threads、messages、send、interrupt、teams、stream）；第 4 节 Core 缺口 → Task 1/2/3（snapshot 事件当前无人发布，不补；chunk 的 agentThreadId 已补齐，前端用 `?? 'primary'` 兜底）；第 5 节前端 → Task 9-18；第 6 节错误处理 → Task 6（REST 映射）/7（SSE 断开）/10（重连兜底）/8（启动错误）；第 7 节测试 → 各任务内嵌 + Task 19。
- **类型一致性**：`ContentBlock`、`SessionState`、`WebAppDeps`、`createFakeAgentSystem`、`api.*`、`startEventBus` 在产出任务与消费任务间签名一致；`parseBusEvent` 返回 `AgentSystemEvent | null` 与 bus.ts 使用一致。
- **已知取舍**：toolResult 消息在 thread 面板不渲染（最小版）；`snapshot` 事件未发布故前端不处理；单 Agent session 的 thread 面板整体隐藏（spec 5.1）。
