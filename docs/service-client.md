# Runtime Service 与 TypeScript Client

`rem-agent-service` 和 `rem-agent-client` 是持久化 `AgentRuntime` 的远程适配层。Service 不拥有 Agent、Worker 或 Storage 生命周期；宿主应用负责创建并初始化 Core Runtime，再把它交给 Service。

## Service

Service 使用标准 Fetch handler，可直接接入 Node HTTP、Hono、Cloudflare Workers 或其他支持 Fetch 的宿主：

```typescript
import { createRuntimeService } from 'rem-agent-service';

const service = createRuntimeService({
  runtime,
  authenticator: {
    authenticate: async (request) => ({
      tenantId: request.headers.get('x-tenant-id') ?? 'demo',
      principal: { principalId: 'service-user', roles: ['operator'] },
    }),
  },
});

// Node 22 / Fetch-compatible server:
serve({ fetch: service.fetch, port: 8080 });
```

认证器是唯一可信的 `tenantId` / `principal` 来源。请求 body 中的身份字段会被拒绝。

## HTTP API

```text
GET  /v1/agents
GET  /v1/agents/:agentId?revision=...
GET  /v1/sessions
POST /v1/sessions
GET  /v1/sessions/:sessionId
GET  /v1/sessions/:sessionId/entries
PATCH /v1/sessions/:sessionId/contexts
POST /v1/runs
GET  /v1/runs?sessionId=...&status=...&cursor=...&limit=...
GET  /v1/runs/:runId
POST /v1/runs/:runId/cancel
GET  /v1/runs/:runId/events?afterSequence=1&limit=100
GET  /v1/runs/:runId/stream
GET  /v1/runs/:runId/artifacts
GET  /v1/runs/:runId/execution/nodes
GET  /v1/runs/:runId/execution/entries?afterSequence=1&limit=100
GET  /v1/runs/:runId/execution/deliveries
GET  /v1/runs/:runId/tool-invocations
POST /v1/runs/:runId/tool-invocations/:invocationId/resolve
GET  /v1/artifacts/:artifactId
GET  /v1/health
```

创建 Run 时使用 `Idempotency-Key` header：

```http
POST /v1/runs
Content-Type: application/json
Idempotency-Key: crm-ticket-1001-v1

{"agentId":"ticket-worker","trigger":{"type":"message","content":"处理工单 T-1001"}}
```

错误统一返回：

```json
{
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "Run not found",
    "retryable": false
  }
}
```

`/stream` 是可丢失的结构化 Signal 流，`event: signal` 同时承载 Run 生命周期、文本/Reasoning 增量和工具执行状态。例如：

```json
{"runId":"run-1","type":"assistant.text.delta","data":{"messageIndex":0,"contentIndex":0,"delta":"你好"},"occurredAt":"2026-01-01T00:00:00.500Z"}
```

实时 Signal 只是投影，不写入 RunEvent；RunEvent、SessionEntry 和 ToolInvocation 才是持久化事实。增量可以在断线时丢失，订阅方应在流结束或重连后读取一次 Run 与 entries 恢复最终状态。SSE 断开不会取消 Run，取消必须显式调用 `/cancel`。当前不提供 `Last-Event-ID` 或增量回放。

## TypeScript Client

```typescript
import { RuntimeClient } from 'rem-agent-client';

const client = new RuntimeClient({
  baseUrl: 'https://agent.example.com',
  headers: { Authorization: `Bearer ${token}` },
});

const run = await client.runs.start({
  agentId: 'ticket-worker',
  idempotencyKey: 'crm-ticket-1001-v1',
  trigger: { type: 'message', content: '处理工单 T-1001' },
});

const completed = await client.runs.waitForCompletion(run.runId);
const artifacts = await client.artifacts.listByRun(completed.runId);
```

需要实时 UI 或操作进度时，可以直接订阅同一条 Run；未知的未来事件会原样透传，已知实时事件会严格校验 payload：

```typescript
for await (const signal of client.runs.subscribe(run.runId)) {
  if (signal.type === 'assistant.text.delta') render(signal.data.delta);
  if (signal.type === 'tool.execution.started') showTool(signal.data);
}
```

后台任务无需消费 Signal，继续使用 `start()` + `waitForCompletion()` 即可。`waitForCompletion()` 忽略非终态 Signal，只在终态后读取一次持久化 Run；健康 SSE 提前结束时才启用轮询兜底。

Client 会把 `idempotencyKey` 转成 HTTP header、把日期字段恢复为 `Date`、把 Service 错误转换为 `RuntimeClientError`，并解析 SSE `event: signal` 帧。

## Operational Task 与 Health

Task API 是现有 Run API 的组合，不新增 `/v1/tasks`：

```typescript
const outcome = await client.tasks.execute({
  agentId: 'ticket-worker', input: { ticketId: 'T-1001' }, idempotencyKey: 'task-T-1001-v1',
});
if (outcome.status === 'completed') {
  // JSON Artifact 会解码到 value；URI Artifact 只返回 artifact 指针
  console.log(outcome.result.value, outcome.result.artifact.artifactId);
} else if (outcome.status === 'waiting') {
  // 通过 runs.resolveToolInvocation 处置后，再次调用 client.tasks.wait(runId)
  console.log(outcome.unknownInvocations);
}
```

`tasks.execute` 的健康请求序列固定为创建 Run、建立一次 SSE、读取一次终态 Run 和一次主
Artifact。SSE 断开、慢消费者溢出或未知未来 Signal 都回退到持久化 Run 查询；调用方 Abort
只停止等待，不取消服务端 Run。

`client.health.get()` 读取 `/v1/health`。ready 返回 200，其余状态返回 503，但两者都使用
同一 `RuntimeHealth` JSON 结构。健康响应只包含 runtime、storage、worker 状态和稳定错误码，
不包含路径、模型、租户、凭证或异常文本。

嵌入式宿主可以注册 `RuntimeObserver`。Observer 按注册顺序接收运行、模型、工具、Worker
和生命周期事件；事件已深隔离且不含 prompt、task input、工具输入/结果、Artifact、claims、
请求头或 API Key。Observer 的异常会被吞掉，不会改变 Run 结果。
