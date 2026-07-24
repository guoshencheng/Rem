# REM 路由包与 UI 组件包拆分设计

日期：2026-07-24
状态：已获用户确认

## 背景与目标

当前 `packages/web` 同时承担 REM API 路由（`src/app/api/*`，10 个路由文件）与全部聊天 UI。目标：

1. 将 REM 相关 API 路由抽为独立包 `rem-agent-routes`，供任意 Next.js 宿主复用；包内提供 CLI 一键生成薄壳 catch-all 路由。
2. 将 REM 聊天 UI 抽为独立包 `rem-agent-ui`，支持两种使用模式：完整应用 `<RemApp />` 与单独聊天框 `<RemChat />`；接口前缀通过 `apiPrefix` prop 配置。
3. `packages/web` 瘦身为组合层：layout + `<RemApp />` + 生成的薄壳路由。

## 整体架构

```text
packages/
  routes/   rem-agent-routes   — Next.js API 路由包（server-only）
    src/
      router.ts          — 路径→handler 路由表 + createRemHandler() 分发器工厂
      handlers/          — agent.ts / sessions.ts / approvals.ts / workspaces.ts（按域拆分，各 ≤200 行）
      workspace-param.ts — getWorkspace() 提取（从 web 迁入）
      types.ts           — RouteContext、Handler 签名
      cli.ts             — `rem-routes init` 生成薄壳 catch-all
  ui/       rem-agent-ui       — React 组件包（client）
    src/
      components/  RemApp.tsx、RemChat.tsx、chat/*、sidebar/*、workspace/*（从 web 迁入）
      hooks/       use-agent-bus、use-agents、use-todos 等（从 web/lib 迁入）
      lib/         agent-bus SSE 客户端、api-client.ts、markdown.ts
  web/      rem-agent-web      — layout.tsx、page.tsx（≈ <RemApp apiPrefix="/api/rem" />）、
                                 app/api/rem/[...path]/route.ts（CLI 生成的薄壳）、tailwind 配置
```

数据流：`RemChat` → `api-client(apiPrefix)` → `fetch /api/rem/agent/run` → 薄壳 catch-all → `createRemHandler()` → `handlers/*` → `IAgentService`。

关键决策：容器/DI 归宿主所有。薄壳生成时引用宿主提供的 `getAgentService()` 工厂（容器路径可配，默认 `@/lib/container`），路由包不实例化 core。

## routes 包设计

### 路由分发器

```typescript
// router.ts
export interface RemRoutesOptions {
  getAgentService: () => Promise<IAgentService> | IAgentService;
}
export function createRemHandler(opts: RemRoutesOptions) {
  return (req: NextRequest, segments: string[]) => Promise<Response>;
}
```

- 路由表为 `path → { GET?, POST?, ... }` 映射；segments 来自 catch-all 的 `params.path`，如 `["agent","run"]`、`["sessions", id, "todos"]`。
- 现有 10 个路由文件的逻辑按域迁入：
  - `handlers/agent.ts`：run / stream(SSE) / interrupt / reset
  - `handlers/sessions.ts`：list / create / [id] / [id]/todos
  - `handlers/approvals.ts`：list / [id]/resolve
  - `handlers/workspaces.ts`：list
- 错误处理统一为 `toErrorResponse(err)`：`ServiceError` → 保留 status/message，`SyntaxError`（坏 JSON）→ 400，其余 → 500；未匹配路径 → 404 `{ error: 'Not found' }`。
- SSE 流（原 `/api/agent/stream`）在 catch-all 下正常工作（直接返回 Response，Next 不干预 body stream）。

### CLI 生成脚本

```bash
pnpm rem-routes init
# 选项：--prefix api/rem（默认）、--container-path @/lib/container、--app-dir src/app
```

生成单个文件 `src/app/api/rem/[...path]/route.ts`：

```typescript
import { createRemHandler } from 'rem-agent-routes';
import { getContainer } from '@/lib/container';

const handle = createRemHandler({
  getAgentService: async () => (await getContainer()).resolve('agentService'),
});

async function route(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, (await ctx.params).path);
}
export { route as GET, route as POST, route as DELETE, route as PUT };
```

- 幂等：目标文件已存在则提示并跳过；`--force` 强制覆盖。
- `next`、`rem-agent-bridge` 列为 peerDependencies。

## UI 包设计

### 公共 API

```typescript
<RemApp apiPrefix="/api/rem" workspace={ws} />
// 完整应用：侧栏（会话列表/搜索/新建）+ workspace 选择 + 聊天区；内部管理 sessionId 状态

<RemChat apiPrefix="/api/rem" sessionId={id} workspace={ws} />
// 单独聊天框；sessionId 由宿主传入（受控）
```

- 共享 props：`apiPrefix`（默认 `/api/rem`）、`workspace`、`className`。
- 所有请求收敛到 `lib/api-client.ts`：`createApiClient(apiPrefix)` 返回 `{ run, interrupt, reset, listSessions, createSession, ... }`；hooks 通过 context 获取 client；`apiPrefix` 变化时 client 重建。
- SSE：`hooks/use-agent-bus.ts` 订阅 `${apiPrefix}/agent/stream?workspace=...`，从 web 迁入并改为接收 apiPrefix。
- 组件迁移：`components/chat/*`、`sidebar/*`、`workspace/*` 原样迁入，仅将 fetch 调用替换为 api-client；`RemApp` 复刻现 `page.tsx` 的组合逻辑。
- 数据获取方式：组件自拉数据（hooks 内 fetch + SSE），不外注入。

### 样式与构建

- 组件全部使用 Tailwind 类名；宿主需在 `tailwind.config` 的 `content` 中加入 `./node_modules/rem-agent-ui/dist/**/*.js`（README 说明）。
- 构建用 tsup：`dist/index.js`（ESM+CJS）+ `dist/index.d.ts`，入口带 `"use client"` banner；`react`/`react-dom` 为 peerDependencies。
- 深色模式、markdown 渲染（现 `lib/markdown.ts`）随组件迁入。

### web 包迁移后

- `page.tsx` ≈ 10 行：`<RemApp apiPrefix="/api/rem" />`。
- 旧 `app/api/agent|sessions|approvals|workspaces` 目录删除，由 CLI 生成的 `app/api/rem/[...path]/route.ts` 替代。

## 错误处理

- routes 包：见上方 `toErrorResponse()` 规则。
- UI 包：api-client 非 2xx 抛 `ApiError(status, message)`；聊天发送失败在消息流内展示错误态，列表加载失败展示可重试占位 UI（沿用 web 现有行为）。

## 测试

- routes 包：vitest 单测路由表分发（mock `getAgentService`）、各域 handlers 的参数校验与错误映射；CLI 在临时目录跑 `init` 验证生成内容与幂等。
- UI 包：hooks 层单测（api-client mock fetch；use-agent-bus mock EventSource）；组件层不引入 RTL，与 web 现有测试策略一致。
- 迁移后 `pnpm typecheck && pnpm test` 全绿，并手动验证 web 全流程（发消息、SSE 流、审批、workspace 切换）。

## 迁移步骤

1. 新建 `packages/routes`：迁入 handlers / router / CLI；web 切换为薄壳路由 + 新前缀 `/api/rem`。
2. 新建 `packages/ui`：迁入组件与 hooks；web `page.tsx` 改为 `<RemApp />`。
3. 清理 web 中已迁移的 `components/`、`lib/`、`app/api/*` 旧文件。
4. 更新 AGENTS.md 项目结构与相关 docs。

每步独立可验证；UI 未迁完前 web 可用旧组件 + 新路由。

## URL 变更

旧路径 → 新路径（统一 `/api/rem` 前缀，前端调用点随组件迁入 api-client 同步修改）：

- `/api/agent/run|stream|interrupt|reset` → `/api/rem/agent/...`
- `/api/sessions*` → `/api/rem/sessions*`
- `/api/approvals*` → `/api/rem/approvals*`
- `/api/workspaces` → `/api/rem/workspaces`
