# Runtime Service + TypeScript Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为持久化 `AgentRuntime` 增加可独立部署的 HTTP Service 与 TypeScript Client，使外部企业应用能够创建、查询、取消、订阅 Run 并读取 Artifact。

**Architecture:** Service 是无框架的 Fetch `Request -> Response` 适配层，只负责认证上下文、JSON/SSE 序列化、错误映射和调用 `runtime.as(context)`；Agent 生命周期仍完全由 Core Runtime 管理。Client 是远程协议封装，复用稳定领域类型，提供 HTTP 方法、SSE AsyncIterable、错误对象和完成等待，不复制 Worker 或 Run 状态逻辑。

**Tech Stack:** TypeScript 5、Node.js 22 Web Fetch API、Vitest、Rem Agent Core Runtime。

---

### Task 1: 建立 Service 包与协议类型

**Files:**
- Create: `packages/service/package.json`
- Create: `packages/service/tsconfig.json`
- Create: `packages/service/src/types.ts`
- Create: `packages/service/src/request-context.ts`
- Create: `packages/service/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: 写 Service 包配置与协议类型**

Service 包只依赖 `rem-agent-core`，使用 Node 原生 `Request`、`Response`、`ReadableStream`，不依赖 Hono 或 Web UI。

```ts
export interface RuntimeAuthenticator {
  authenticate(request: Request): RuntimeRequestContext | Promise<RuntimeRequestContext>;
}

export interface RuntimeServiceDeps {
  runtime: AgentRuntime;
  authenticator: RuntimeAuthenticator;
  streamKeepAliveMs?: number;
}
```

- [x] **Step 2: 安装 workspace 依赖并确认包可解析**

Run: `pnpm install --lockfile-only`

Expected: lockfile 新增 `rem-agent-service` importer，未引入新的运行时依赖。

- [x] **Step 3: 更新根构建入口**

根脚本增加 Service 与 Client 的 build/typecheck/test 调用位置；此时 Client 包先以占位构建配置存在，下一任务补全实现。

### Task 2: 实现 HTTP Service 路由、错误映射与 SSE

**Files:**
- Create: `packages/service/src/error-response.ts`
- Create: `packages/service/src/json-body.ts`
- Create: `packages/service/src/sse.ts`
- Create: `packages/service/src/runtime-service.ts`
- Modify: `packages/service/src/index.ts`
- Test: `packages/service/tests/runtime-service.test.ts`
- Test: `packages/service/vitest.config.ts`

- [x] **Step 1: 写失败测试覆盖公开协议**

覆盖：

- `POST /v1/runs` 认证后调用 scoped runtime，并把 `Idempotency-Key` 写入 StartRunInput；
- 租户由 authenticator 返回，不能从请求 body 覆盖；
- `GET /v1/runs/:id`、`POST /v1/runs/:id/cancel`、事件查询、Artifact 查询；
- `GET /v1/runs/:id/stream` 返回 SSE `event: signal`；
- `RuntimeError` 映射为稳定 `{ error: { code, message, retryable } }`；未知异常不泄露内部 message；
- 无效 JSON、非法 cursor/limit 返回 `INVALID_INPUT`。

- [x] **Step 2: 实现请求解析与错误映射**

只接受 JSON object body；Service 不复制 Core 的业务校验，结构问题在边界转换为 `INVALID_INPUT`，业务校验继续由 Core 完成。错误状态映射：身份 401、权限 403、资源不存在 404、冲突 409、输入/触发器/上下文 400、可重试存储/模型/执行错误 503、其他 500。

- [x] **Step 3: 实现 Runtime Service**

公开路由：

```text
GET  /v1/agents
GET  /v1/agents/:agentId
GET  /v1/sessions/:sessionId
POST /v1/runs
GET  /v1/runs/:runId
POST /v1/runs/:runId/cancel
GET  /v1/runs/:runId/events?afterSequence=&limit=
GET  /v1/runs/:runId/stream
GET  /v1/runs/:runId/artifacts
```

所有资源操作先由 `authenticator` 生成 `RuntimeRequestContext`，再调用 `runtime.as(context)`；Service 不接受客户端提供的 tenant/principal 字段。

- [x] **Step 4: 实现 SSE 编码与断开处理**

Service 将 `RunSignal` 编码为：

```text
event: signal
data: {"runId":"...","type":"run.completed",...}

```

连接断开时使用请求 `AbortSignal` 结束 Core 订阅；保留可选 heartbeat，避免代理长时间关闭空闲连接。

- [x] **Step 5: 运行 Service 测试**

Run: `pnpm --filter rem-agent-service test`

Expected: PASS。

### Task 3: 建立 TypeScript Client 与远程错误模型

**Files:**
- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/src/types.ts`
- Create: `packages/client/src/client-error.ts`
- Create: `packages/client/src/http-client.ts`
- Create: `packages/client/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: 写 Client 请求与错误测试**

覆盖：base URL 拼接、静态 headers、`Idempotency-Key`、JSON body、204、服务端结构化错误转换为 `RuntimeClientError`、非 JSON 错误响应安全降级。

- [x] **Step 2: 实现 HTTP Client**

`RuntimeClient` 提供：

```ts
client.agents.list()
client.agents.get(agentId, revision?)
client.sessions.get(sessionId)
client.runs.start(input)
client.runs.get(runId)
client.runs.cancel(runId)
client.runs.listEvents(runId, options?)
client.runs.subscribe(runId, options?)
client.runs.waitForCompletion(runId, options?)
client.artifacts.listByRun(runId)
```

`runs.start` 将 `idempotencyKey` 放入 HTTP header，request body 不重复携带该字段；其它字段原样传给 Service。

- [x] **Step 3: 运行 Client 测试**

Run: `pnpm --filter rem-agent-client test`

Expected: PASS。

### Task 4: 实现 SSE Client 与完成等待

**Files:**
- Create: `packages/client/src/sse-client.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/tests/sse-client.test.ts`

- [x] **Step 1: 写 SSE 分块与 Abort 测试**

测试跨 chunk 的 SSE 行、空行分帧、JSON data、多行 data、服务端错误状态和 AbortSignal。

- [x] **Step 2: 实现 `runs.subscribe`**

使用 Fetch response body 的 `ReadableStreamDefaultReader`，按 SSE 帧解析，只接受 `event: signal`；Malformed JSON 结束当前订阅并抛 `RuntimeClientError`，不静默产生错误 RunSignal。

- [x] **Step 3: 实现 `waitForCompletion`**

先查询 Run；非终态时并行等待 SSE signal 与短轮询，收到任何 signal 后重新读取持久化 Run。Abort 优先于终态返回，订阅与 timer 在 finally 中清理。

- [x] **Step 4: 运行 Client 测试**

Run: `pnpm --filter rem-agent-client test`

Expected: PASS。

### Task 5: 添加 Service + Client 真实端到端验收

**Files:**
- Create: `packages/service/tests/runtime-client-acceptance.test.ts`
- Modify: `packages/service/src/index.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `package.json`
- Modify: `docs/architecture.md`
- Create: `docs/service-client.md`

- [x] **Step 1: 写内存 Fetch 端到端测试**

用现有 Fake/Scripted AgentRuntime 组装 Service，把 Service 的 `fetch` 作为 Client 的自定义 fetch；验证：

1. Client 使用 `Idempotency-Key` 创建 Run；
2. Service 通过 authenticator 生成 tenant/principal；
3. Client 等待 Run 完成并读取 Artifact；
4. Client 通过事件列表和 SSE 都能观察终态；
5. 使用不同 tenant 查询同一 Run 返回 `RUN_NOT_FOUND`；
6. 重复相同幂等键返回同一 Run。

- [x] **Step 2: 更新文档**

新增最小嵌入示例：Core Runtime → `createRuntimeService` → Node `serve`；以及 Client 调用示例。明确 Service 不拥有 Worker/Agent 生命周期，认证由宿主注入。

- [x] **Step 3: 全量验证**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`

Expected: Core、Service、Client、Web 全部通过，结构检查无超限文件。

### Task 6: 将现有 Web 工作台接入 Runtime Service + Client

**Files:**
- Modify: `packages/core/src/sdk/runtime-storage.ts`
- Modify: `packages/core/src/sdk/runtime-storage-repositories.ts`
- Modify: `packages/core/src/application/runtime/types.ts`
- Modify: `packages/core/src/application/runtime/scoped-agent-runtime.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/runtime-session-repository.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/runtime-store.ts`
- Modify: `packages/core/tests/helpers/fake-runtime-store.ts`
- Modify: `packages/service/src/runtime-service.ts`
- Modify: `packages/service/src/types.ts`
- Modify: `packages/service/tests/runtime-service.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/types.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/tests/runtime-client.test.ts`
- Modify: `packages/web/package.json`
- Modify: `packages/web/vite.config.ts`
- Modify: `packages/web/tsconfig.json`
- Modify: `packages/web/tsconfig.server.json`
- Modify: `packages/web/src/server/app.ts`
- Modify: `packages/web/src/server/index.ts`
- Modify: `packages/web/src/client/api/client.ts`
- Modify: `packages/web/src/client/app.tsx`
- Modify: `packages/web/tests/api-client.test.ts`
- Modify: `packages/web/tests/server-routes.test.ts`

- [x] **Step 1: 扩展 Runtime Session 查询/创建协议**

增加 scoped `sessions.list/create/listEntries`，Service 暴露 `/v1/sessions` 与 `/v1/sessions/:id/entries`；所有查询按 tenant 隔离，创建 Session 只写 Runtime 存储，不重新引入旧 AgentSystem。

- [x] **Step 2: 用 Runtime 组装 Web 服务端**

Web server 从已有 assembly 构造 Runtime、静态默认 AgentDefinition 和认证器，将 Runtime Service 挂载在 `/v1`，保留旧 `/api/rem` 路由用于兼容测试。

- [x] **Step 3: 用 RuntimeClient 替换 Web 浏览器 API**

前端 API facade 改用 `RuntimeClient`；发送消息创建 Runtime Run，等待 SSE/持久化终态后刷新 Session entries；取消使用当前 Run；旧 UI 组件继续通过 facade 获得兼容的 SessionInfo/Message 形状。

- [ ] **Step 4: 浏览器端到端验收**

启动 Web，使用浏览器验证 `/v1` 实际链路、Session 创建、消息发送、等待完成、取消和刷新后历史恢复；同时运行 Web/Service/Client/Core 全量检查。

## 完成定义

- 外部 TypeScript 应用只依赖 Client 即可创建、查询、取消、订阅 Run 并读取 Artifact。
- Service 不重新实现 Agent/Worker/Run 状态机。
- tenant/principal 只能来自注入的认证器，不能由请求 body 伪造。
- SSE 是可丢失 Signal；事件列表仍是持久化事实来源。
- RuntimeError 在远程边界保持稳定 code、message、retryable 语义。
- Client 与嵌入式 `AgentRuntime` 使用同一套 Run 语义。
