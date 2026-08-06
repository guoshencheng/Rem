# Rem Web UI 重建设计

- 日期：2026-08-06
- 状态：已批准（头脑风暴确认）
- 范围：最小可用版 Web UI，支持单 Agent 与多 Agent Session，不支持多 workspace

## 1. 背景与目标

Core-first 重建完成后，`packages/core` 已暴露传输无关的 `AgentSystem` 门面，覆盖单/多 Agent Session 的创建、消息发送、中断、中心聊天投影、Thread 查询和系统事件订阅。当前仓库没有任何活动的接入层与 UI。

本设计参考 `archive/web`（Hono + React/Vite）与 `archive/ui`（组件库）的旧实现，重建一套最小可用 Web UI：

- Session 列表（新建时可选择 team 创建多 Agent Session）+ 聊天流 + 中断
- 多 Agent Session 的可视化：中心会话保持简单，Agent 细节收进独立 Thread 面板
- 明确不做：steer/follow-up、session 删除/搜索/改标题、审批、todos 面板、附件、token 用量、多 workspace 切换

## 2. 总体架构

新包 `packages/web`（pnpm workspace 的 `packages/*` 已自动覆盖），单包内含 server 与 client 两层：

```text
packages/web/
  package.json            # rem-agent-web，deps: rem-agent-core (workspace:*)
  components.json         # shadcn/ui 配置（提交进仓库）
  src/
    server/               # Hono 接入层（进程内直接持有 AgentSystem）
      index.ts            # CLI 入口：--workspace <path>（默认 cwd）、--port（默认 3001）
      app.ts              # createWebApp(system): Hono 实例
      routes/             # sessions.ts / chat.ts / threads.ts / teams.ts / stream.ts
      sse.ts              # AgentSystemEvent → SSE 序列化
    client/               # React 19 + Vite + Tailwind v4 + shadcn/ui
      api/                # fetch 封装 + SSE 单例订阅（agent-bus 模式）
      state/              # stream-store：事件归并与状态切片
      components/         # shadcn/ui 壳组件 + 搬运自 archive/ui 的渲染组件
  tests/                  # Vitest
  vite.config.ts          # dev: 3000 端口，proxy /api → 3001
```

**进程模型**：单进程。server 启动时调用 Core 的 `createAgentFromEnv()` 装配得到 `AgentSystem` 实例常驻内存；REST 直接调用它，SSE 直接订阅 `system.events(signal)`。不经过任何中间 bridge 包。生产模式 Hono 同时服务静态文件与 API（沿用 archive/web 模式）。

**职责边界**（遵循 Core 红线）：

- server 只做 HTTP/SSE 协议转换、参数校验、事件序列化推流
- 前端只做渲染与交互，所有 Agent 语义来自 API 响应与事件
- Provider / team / workspace 配置全部留在 Core，前端零感知
- 单一 workspace 由 server 启动参数 `--workspace`（默认 cwd）确定，UI 完全不感知 workspace 概念

## 3. API 设计

全部挂在 `/api/rem` 前缀下：

| 方法 + 路径 | 说明 | 对应 Core 能力 |
|---|---|---|
| GET `sessions` | Session 列表（含 mode/activity/title） | `system.listSessions(workspace)` |
| POST `sessions` | 新建 Session，body `{ teamId? }` | `system.createSession` |
| GET `sessions/:id/chat` | 中心会话投影消息 | `system.getSessionChat` |
| GET `sessions/:id/threads` | 该 Session 的 AgentThread 列表 | `system.getSessionThreads` |
| GET `sessions/:id/threads/:threadId/messages` | 某 Thread 私有视角消息 | `system.getAgentThreadContext` |
| POST `sessions/:id/send` | 发送用户消息，body `{ content }` | `system.send` |
| POST `sessions/:id/interrupt` | 中断 | `system.interrupt` |
| GET `teams` | 可用 team 列表（新建 Session 下拉用） | Core 需补 `listTeams` |
| GET `stream` | SSE，全系统事件流 | `system.events(signal)` |

**SSE 协议**：沿用 archive 验证过的格式 `event: bus\ndata: <AgentSystemEvent JSON>\n\n`，15s heartbeat 注释行。前端单例连接 + 指数退避重连（1s → 15s 上限）；重连成功后对当前打开的 Session 全量重拉 `chat` + `threads` + 选中 Thread 的 `messages` 兜底。

**统一错误响应**：`{ error: string, code?: string }`，按 Core 错误类型映射状态码（404 Session 不存在 / 409 Session 运行中冲突等）。

## 4. Core 缺口补齐（本设计的一部分，在 Core 内完成）

1. **`AgentSystem.listTeams(): Promise<TeamInfo[]>`**：透传 config provider 的 `teams`（id + name? + organizer + members），供前端新建 Session 下拉。`TeamInfo` 为新增导出类型。
2. **事件字段确认**：核实 `AgentSystemEvent` 的 `chunk` / `snapshot` 事件携带 `sessionId` 与 `agentThreadId`，前端据此把事件路由到中心流或某个 Thread 面板；若缺字段则在 Core 补齐。

两项改动都附带 Core 自己的单元测试。

## 5. 前端设计

### 5.1 页面布局（单页无路由，沿用 archive 模式）

```text
┌──────────────────────────────────────────────────────┐
│ 顶部栏: REM | session 面包屑 | mode 徽标 | ⏹ ＋      │
├──────────┬─────────────────────────┬─────────────────┤
│ Session  │  中心会话（公开消息）    │  Thread 面板     │
│ 列表      │  + 输入框/中断         │  tab 切换 +      │
│          │                         │  私有消息流       │
├──────────┴─────────────────────────┴─────────────────┤
│ 状态栏: workspace · session · threads · SSE 连接      │
└──────────────────────────────────────────────────────┘
```

- **中心流**：只显示「用户消息 + 对用户的公开回复」（`getSessionChat` 投影），不显示 tool call 与 Thread 内部讨论
- **Thread 面板**：顶部 tab 切换条（各 AgentThread + 运行状态圆点），下方显示选中 Thread 的完整私有消息流（含 tool call 块）。单 Agent Session 时面板整体隐藏
- **Session 列表**：条目标注 single / multi-agent

### 5.2 视觉风格

shadcn/ui 组件体系 + 定制 dark 主题 token，呈现「暗色紧凑工作台」风格（参考 darlulu 装配工作台）：

- 深色底：background `#08090c` / card `#12141a` / border `#292b32`
- 强调色紫：primary `#6752da`，选中态用 primary 浅底变体
- 紧凑密度：小字号 + 小 padding，通过 Tailwind 尺寸类控制，不改组件内部样式
- 顶部栏 / 状态栏用 flex + Separator；session 类型用 `Badge variant="outline"`

组件映射：Sidebar → session 列表；Tabs/ToggleGroup → thread 切换；Card → 消息与 tool call；ScrollArea → 滚动区；InputGroup + Button → 输入框与中断；Select → 新建 Session 选 team；Empty → 空态。全部使用语义色 token，不写死颜色。

### 5.3 组件来源

- **新写**（shadcn/ui 壳）：`session-list`、`thread-panel`、`chat-composer`、顶部栏、状态栏
- **搬运自 archive/ui 并适配新类型**：`markdown-content`、`tool-call-block`、`reasoning-block`、`copy-button`、消息气泡（逻辑搬运，外壳样式换成 shadcn Card）

### 5.4 状态层（新写，替代 archive 752 行的 use-agents.ts）

`stream-store`（zustand），三块切片：

1. `sessions: SessionInfo[]`
2. 按 sessionId 的中心消息列表 + 流式增量
3. 按 threadId 的 thread 消息列表 + 流式增量

SSE 事件按 `sessionId` / `agentThreadId` 路由到对应切片；`snapshot` 事件全量替换对应切片；`chunk` 事件做增量追加（归并思路参考 archive `stream-reducer`，输入改为 `AgentSystemEvent`，输出直接是 `SessionChatMessage` 的增量更新）。

前端数据模型直接复用 Core 导出类型 `SessionInfo`、`SessionChatMessage`、`AgentThread`、`AgentSystemEvent`，不引入旧 `UIMessage`。

## 6. 错误处理

- **REST**：统一错误响应 + 状态码映射（见第 3 节）
- **SSE**：断线指数退避重连 + 重连后全量重拉兜底（见第 3 节）
- **Core 运行错误**：`session-error` 事件经 SSE 推到前端，在对应 scope（中心流或 thread 面板）的消息流尾部展示错误条
- **启动错误**：`--workspace` 路径不存在或 Core 装配失败（如缺 API key）→ server 打印明确错误并退出

## 7. 测试

- **server 路由测试**：内存 fake `AgentSystem`（实现同一接口），Hono `app.request()` 直接断言 HTTP 响应，不起真实端口；SSE 用可读流断言事件序列
- **Core 缺口**：`listTeams` 与事件字段补齐各带 Core 单测
- **前端**：Vitest + Testing Library；`stream-store` 的事件归并（chunk 增量、snapshot 全量替换、sessionId/threadId 路由）是核心测试对象；组件层测 thread 面板切换与中心流渲染
- **不做**：E2E、真实 LLM 集成测试（最小可用版范围外）

## 8. 实现路线（已确认的选型）

路线 3「混合」：

- 包骨架与通信模式照搬 archive 验证方案（Hono + Vite、REST + 单条 SSE、`event: bus`）
- 渲染层组件从 archive/ui 按文件搬运并适配新消息模型
- 状态层按 `AgentSystemEvent` 重写精简版
- 多 Agent Thread 面板与全部壳组件用 shadcn/ui 新写

## 9. 验收标准

1. `pnpm --filter rem-agent-web dev` 启动后，浏览器可新建单 Agent Session 并流畅聊天（流式渲染 + 中断）
2. 新建 Session 时可选 team，多 Agent Session 的中心流只显示公开消息，Thread 面板可切换查看各 Agent 私有视角（含 tool call）
3. 断网恢复后消息不丢失（SSE 重连 + 全量兜底）
4. `pnpm build && pnpm typecheck && pnpm test` 全绿，结构检查无新增违规
