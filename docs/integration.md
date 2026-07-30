# 集成指南：Node 后端 + 前端

本文档面向**集成者**：把 Rem Agent 的能力（ReAct 循环、工具、审批、会话持久化、流式 UI）嵌入你自己的 Node 后端 + React 前端。

完整可运行的参考实现见 `packages/web`（Next.js 15 demo，全部代码约 60 行）。

## 架构

```text
浏览器                          Node 后端
┌──────────────────┐          ┌─────────────────────────────────────┐
│ rem-agent-ui     │          │ rem-agent-routes   HTTP 路由分发     │
│  <RemApp />      │  HTTP+SSE │      ↓                              │
│  AgentRemoteService ────────→│ rem-agent-bridge   AgentService     │
└──────────────────┘          │      ↓                              │
                              │ rem-agent-core     ReAct 循环/工具/  │
                              │                    审批/持久化        │
                              └─────────────────────────────────────┘
```

四个包各司其职：

| 包 | 角色 | 运行位置 |
|---|---|---|
| `rem-agent-core` | Agent 引擎：循环、工具、MCP、审批、压缩、持久化 | 服务端 |
| `rem-agent-bridge` | `IAgentService` 接口 + 服务端实现 `AgentService` + 客户端 `AgentRemoteService` | 两端 |
| `rem-agent-routes` | `createRemHandler`：把 `IAgentService` 暴露为一组标准 HTTP/SSE 端点 | 服务端 |
| `rem-agent-ui` | React 组件：`<RemApp />`（完整应用）、`<RemChat />`（单聊天框） | 浏览器 |

前端**不直接依赖 core**，只通过 `AgentRemoteService` 走 HTTP/SSE 与后端通信。

## 前置要求

- Node.js >= 22.19.0
- React >= 19、Tailwind CSS >= 4（仅前端使用 `rem-agent-ui` 时）

## 安装

```bash
# 服务端
npm install rem-agent-core rem-agent-bridge rem-agent-routes

# 前端
npm install rem-agent-ui
```

## 第一步：配置模型

Core 拥有 provider 配置，集成方**不需要**（也不应）直接调 LLM SDK。配置按以下优先级合并：home 级配置文件 → workspace 级配置文件 → 环境变量 → 代码 overrides。

最常用的方式是写一个配置文件 `rem-agent.config.json`（放在服务进程的工作目录）：

```json
{
  "models": {
    "default": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

- `apiKey` / `baseURL` 支持 `${ENV_VAR}` 模板，从进程环境变量解析。
- 也可省略 `model` / `baseURL`，此时回退读取 `<PROVIDER>_MODEL`、`<PROVIDER>_BASE_URL` 环境变量（如 `OPENAI_MODEL`）。
- home 级配置路径：`~/.rem-agent/config.json`；workspace 级候选：`rem-agent.config.{json,yaml,yml}` 或 `.rem-agent/config.{json,yaml,yml}`。
- 常用环境变量：`REM_AGENT_MAX_TURNS`、`REM_AGENT_WORKSPACE_ROOT`、`REM_AGENT_READ_ONLY`、`REM_AGENT_PROFILE`、`REM_AGENT_DEBUG=1`。

## 第二步：后端 — 创建 AgentService 单例

```typescript
// lib/agent-service.ts
import path from 'node:path';
import { AgentService, SqliteWorkspaceRepository } from 'rem-agent-bridge';
import { createDefaultAgentPaths, SqliteStorageProvider } from 'rem-agent-core';

const GLOBAL_KEY = '__REM_AGENT_SERVICE__';

async function createService(): Promise<AgentService> {
  const paths = createDefaultAgentPaths();
  const storageProvider = new SqliteStorageProvider({
    dbPath: path.join(paths.agentDir, 'rem-agent.db'),
  });
  await storageProvider.init();

  const service = new AgentService(
    { workspaceRoot: process.cwd(), storageProvider },
    new SqliteWorkspaceRepository(storageProvider.workspaceStore),
  );
  await service.init();
  return service;
}

// 缓存到 globalThis，避免 Next.js 开发模式 HMR 重复初始化
export function getAgentService(): Promise<AgentService> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createService();
  }
  return g[GLOBAL_KEY] as Promise<AgentService>;
}
```

数据落在 `~/.rem-agent/`（可用 `REM_AGENT_HOME` 覆盖）：SQLite 库存 session/消息/审批规则，`sessions/` 存 JSONL。

## 第三步：后端 — 挂 HTTP 路由

`createRemHandler` 返回一个**标准 Fetch API** 处理函数 `(req: Request, segments: string[]) => Promise<Response>`，可挂到任何支持 Request/Response 的框架。

Next.js App Router（catch-all）：

```typescript
// app/api/rem/[...path]/route.ts
import { createRemHandler } from 'rem-agent-routes';
import type { NextRequest } from 'next/server';
import { getAgentService } from '@/lib/agent-service';

const handle = createRemHandler({ getAgentService });

async function route(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export { route as GET, route as POST, route as PATCH, route as DELETE, route as PUT };
```

注意：`rem-agent-core` / `rem-agent-bridge` 依赖 `better-sqlite3`（原生模块），Next.js 中需加入 `serverExternalPackages`：

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  serverExternalPackages: ['rem-agent-core', 'rem-agent-bridge', 'better-sqlite3'],
};
```

其他框架同理：把 URL 中 `api/rem/` 之后的路径段拆成数组传给 `handle` 即可。

## 第四步：前端 — 接入 UI

```tsx
// app/page.tsx
'use client';

import { useMemo } from 'react';
import { RemApp, AgentRemoteService } from 'rem-agent-ui';

export default function Home() {
  // 第一个参数为 baseURL（同源留空），apiPrefix 指向第三步挂的路由
  const service = useMemo(() => new AgentRemoteService('', { apiPrefix: '/api/rem' }), []);
  return <RemApp service={service} />;
}
```

样式（Tailwind v4）：

```css
/* globals.css */
@import 'tailwindcss';
@import 'github-markdown-css/github-markdown-dark.css';
@import 'rem-agent-ui/styles.css';
```

- 不需要侧边栏和会话管理时，用 `<RemChat service={...} sessionId={...} />` 嵌入单个聊天框。
- 纯前端（零后端、凭据存浏览器 IndexedDB）的集成方式见 `rem-agent-ui/local` 的 `<RemLocalApp />`，不在本文范围。

## 运行

```bash
export ANTHROPIC_API_KEY=sk-...
npm run dev
```

打开页面即可聊天。内置工具（读写文件、执行命令等）默认开启，高危操作会触发审批条（ApprovalBar 已内置于 UI）。

## HTTP API 一览

`createRemHandler` 暴露的全部端点（`AgentRemoteService` 已封装，一般无需手写调用）：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `agent/run` | 发起一轮对话 `{ sessionId, content }` |
| GET | `agent/stream` | SSE 总线：所有消息/工具/审批/压缩事件 |
| POST | `agent/interrupt` | 中断运行 `{ sessionId }` |
| POST | `agent/reset` | 重置会话 `{ sessionId }` |
| GET/POST | `sessions` | 列出（支持 `?q=` 搜索）/ 创建会话 |
| GET/PATCH/DELETE | `sessions/:id` | 读取消息 / 改标题、置顶 / 删除 |
| GET | `sessions/:id/todos` | 会话的 todo 列表 |
| GET | `approvals?sessionId=` | 待审批列表 |
| POST | `approvals/:id/resolve` | 审批决议 `{ sessionId, decision, rule? }` |
| GET/POST/DELETE | `workspaces` | 工作区管理 |

所有端点接受 `?workspace=<name>` 查询参数做工作区隔离，缺省为 `default`。

## 进阶自定义

| 需求 | 入口 |
|---|---|
| 换 session 存储（内存/文件/自实现） | `AgentService` 构造参数 `storageProvider`，实现 core 的 `StorageProvider` 接口 |
| 加自定义工具 | `AgentServiceOptions`（即 `AgentContextBuildOptions`）注入 `toolProviders`；或走 MCP（配置文件 `mcpServers` 字段） |
| 定制审批策略 | 配置文件 `toolPolicy` / `sessionRules`，或实现 core 的审批相关 provider |
| 定制系统提示 | core 的 system-prompt 装配器（sections 可增删） |

深入阅读：`docs/architecture.md`、`docs/core-design.md`、`packages/core/README.md`。

## 参考实现：packages/web

`packages/web` 就是按本文档搭建的最小 demo，全部业务代码只有 4 个文件：

```text
packages/web/src/
  lib/agent-service.ts              # 第二步：AgentService 单例
  app/api/rem/[...path]/route.ts    # 第三步：挂路由
  app/page.tsx                      # 第四步：<RemApp />
  styles/globals.css                # 样式引入
```

启动方式：

```bash
pnpm install
pnpm --filter rem-agent-web dev   # http://localhost:3000
```
