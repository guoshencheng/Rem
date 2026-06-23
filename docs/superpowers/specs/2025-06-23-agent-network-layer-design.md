# Agent 网络层设计

> 状态：已批准
> 日期：2025-06-23

---

## 1. 目标

建立网络层，让 Agent 通过 HTTP + SSE 对外暴露，所有 UI（TUI、Web UI 等）统一通过 HTTP API + SSE 事件流对接。同时重构 Core，使其变为无状态的纯函数，Provider 由单例的 ProviderManager 管理。

**部署场景：** 先本地（localhost），未来支持远程访问。

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT 层                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │    TUI      │  │   Web UI    │  │  Mobile     │            │
│  │  (终端)      │  │  (浏览器)    │  │  (未来)      │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         └─────────────────┴─────────────────┘                   │
│                         │                                       │
│                    ┌────┴────┐                                  │
│                    │   SDK   │  rem-agent-sdk                    │
│                    │ (Client)│  HTTP + SSE 客户端               │
│                    └────┬────┘                                  │
└─────────────────────────┼───────────────────────────────────────┘
                          │  HTTP / SSE
┌─────────────────────────┼───────────────────────────────────────┐
│                    ┌────┴───────┐                               │
│                    │ Server      │  rem-agent-server              │
│                    │ (HTTP)      │  HTTP server + 路由           │
│                    └────┬───────┘                               │
│                         │                                       │
│              ┌──────────┴──────────┐                            │
│              │    runAgent()       │  rem-agent-core (纯函数)     │
│              │  ProviderManager    │  (单例、懒加载)              │
│              └─────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Core 重构

### 3.1 现状

当前 `CoreAgent` 是一个有状态的类，需要 `ready()` + `initialize()` 两步初始化，内部持有 ProviderRegistry、EventBus、AgentState。

### 3.2 目标

- `CoreAgent` 类废弃，改为无状态纯函数 `runAgent()`
- Provider 生命周期由单例 `ProviderManager` 管理
- 配置统一从配置文件读取

### 3.3 ProviderManager（单例、懒加载、读配置）

```typescript
// packages/core/src/provider-manager.ts

class ProviderManager {
  private static instance?: ProviderManager;
  private registry: ProviderRegistry;
  private config: ServerConfig;

  static async getInstance(configPath?: string): Promise<ProviderManager>;
  // 内部流程：
  //   1. 读取 yaml/config 文件 + 环境变量 → ServerConfig
  //   2. resolve provider → 创建 ProviderRegistry
  //   3. 初始化 registry
  // 首次调用时执行，后续返回同一实例

  get<T>(kind: string): T;
  require<T>(kind: string): T;

  // 配置获取（runAgent 内部使用）
  getModelConfig(): { provider: string; providerConfig: ProviderConfig };
  getAgentConfig(): { maxTurns: number; workspaceRoot: string; agentName: string };
}
```

**ServerConfig 来源优先级：** 命令行参数 > 配置文件 (yaml) > 环境变量 > 默认值

### 3.4 runAgent（无状态纯函数）

```typescript
// packages/core/src/run-agent.ts

export function runAgent(params: {
  input: UserInput;
  sessionId: string;         // 用于加载/保存会话状态
  signal?: AbortSignal;      // 中断控制
}): { stream: AgentStream; output: Promise<AgentOutput> };
```

内部执行流程：
1. 从 `ProviderManager` 获取 `SessionProvider`，加载 session 历史
2. 从 `ProviderManager` 获取 `ToolProvider`、`MemoryProvider` 等
3. 从 `ProviderManager` 获取 `ModelConfig`、`AgentConfig`、`Budget`
4. 创建 `EventBus`
5. 执行 `ReactLoop`
6. 保存 session 到 `SessionProvider`
7. 返回 `{ stream, output }`

---

## 4. Server 包（`rem-agent-server`）

### 4.1 目录结构

```
packages/server/
  src/
    server.ts          — HTTP server 创建和生命周期
    routes/
      agent.ts         — /api/agent/* 路由
      sessions.ts      — /api/sessions/* 路由
      stream.ts        — /api/stream/:sessionId SSE endpoint
    middleware/
      cors.ts          — CORS 配置
      error.ts         — 错误处理中间件
    index.ts
  package.json
  tsconfig.json
```

### 4.2 HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/agent/run` | 提交用户输入，返回 stream URL |
| `POST` | `/api/agent/interrupt` | 中断当前运行 |
| `POST` | `/api/agent/reset` | 重置会话 |
| `GET` | `/api/sessions` | 列出所有会话 |

**POST /api/agent/run**
```typescript
// Request
{ sessionId: string; content: string }

// Response
{ sessionId: string; streamUrl: string }
// streamUrl 格式：/api/stream/:sessionId
```

### 4.3 SSE Endpoint

`GET /api/stream/:sessionId`

事件格式：每个 `AgentStreamChunk` 序列化为一条 SSE 事件。

```
event: chunk
data: {"type":"text-delta","step":1,"partId":"p1","text":"Hello"}

event: chunk
data: {"type":"tool-call-start","step":1,"partId":"tc1","toolCallId":"tc1","toolName":"bash"}

event: chunk
data: {"type":"tool-call","step":1,"partId":"tc1","toolCallId":"tc1","toolName":"bash","input":{...}}

event: chunk
data: {"type":"tool-call-finish","step":1,"partId":"tc1","toolCallId":"tc1","toolName":"bash"}

event: finish
data: {"type":"finish","output":{"content":"...","completed":true}}

// 错误
event: error
data: {"type":"error","error":"..."}
```

### 4.4 Server 启动方式

```typescript
// packages/server/src/index.ts

export function createServer(configPath?: string): Promise<HttpServer>;
```

Server 启动时：
1. `const pm = await ProviderManager.getInstance(configPath)` — 初始化 ProviderManager（单例）
2. 挂载路由
3. 每个 `POST /api/agent/run` 请求：调用 `runAgent({ input, sessionId })` → SSE 流返回

Server 不持有 Agent 实例，每次请求独立调用 `runAgent()`。

### 4.5 Session 隔离

每个 sessionId 对应独立的会话状态，通过 `SessionProvider.load(sessionId)` 加载历史消息。

- 同一 session 不能并发运行多个 `run()`，Server 需检查当前是否有未完成的 signal
- 中断通过 `AbortSignal` 机制实现

### 4.6 配置

```
config/agent.yaml
```

```yaml
server:
  port: 8321
  host: localhost

agent:
  name: "Rem Agent"
  maxTurns: 60
  workspaceRoot: "."

provider:
  type: openai
  model: gpt-4o

sessions:
  dir: ~/.rem/sessions

skills:
  dir: ~/.rem/skills
```

---

## 5. SDK 包（`rem-agent-sdk`）

### 5.1 目录结构

```
packages/sdk/
  src/
    types.ts       — 共享协议类型
    client.ts      — AgentClient
    sse.ts         — SSE 流解析器
    index.ts
  package.json
  tsconfig.json
```

### 5.2 共享类型

```typescript
// types.ts
export interface RunRequest { sessionId: string; content: string; }
export interface RunResponse { sessionId: string; streamUrl: string; }
export interface SessionSummary { sessionId: string; title?: string; updatedAt: number; messageCount: number; }
export type ServerStreamEvent = AgentStreamChunk;
```

### 5.3 AgentClient

```typescript
// client.ts

export class AgentClient {
  constructor(baseUrl: string);  // 如 'http://localhost:8321'

  async run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>>;
  async interrupt(sessionId: string): Promise<void>;
  async reset(sessionId: string): Promise<void>;
  async listSessions(): Promise<SessionSummary[]>;
}
```

`run()` 内部：POST `/api/agent/run` → 获取 streamUrl → GET SSE → 解析为 `AsyncIterable<AgentStreamChunk>`

### 5.4 依赖

```
sdk → core (types only, AgentStreamChunk)
```

---

## 6. TUI 改造

### 6.1 依赖变化

```
之前：tui → core
之后：tui → sdk
```

### 6.2 改造范围

| 文件 | 改动 |
|------|------|
| `app.ts` | 移除 `CoreAgent`、`createUIAgentSession`，改用 `AgentClient` |
| `chat-log.ts` | 不变 |
| `message/stream-message.ts` | 不变（仍消费 `AgentStreamChunk`） |
| `status-bar.ts` | 略微调整 turn 信息 |
| `event-log.ts` | 不变 |
| `session-picker.ts` | 通过 `AgentClient.listSessions()` 获取数据 |

### 6.3 新 app.ts 核心逻辑

```typescript
export class TUIApp {
  private client: AgentClient;
  private sessionId: string;

  constructor(options: { serverUrl: string; sessionId?: string }) {
    this.client = new AgentClient(options.serverUrl);
    this.sessionId = options.sessionId ?? generateId();
  }

  async submit(input: string): Promise<void> {
    const stream = await this.client.run(this.sessionId, input);
    const msg = this.chatLog.startAssistant();

    for await (const chunk of stream) {
      msg.appendChunk(chunk);
      if (chunk.type === 'finish' || chunk.type === 'error') break;
      this.tui.requestRender(true);
    }
  }
}
```

---

## 7. Demo 改造

```typescript
// packages/demo/src/main.ts
import { createServer } from 'rem-agent-server';
import { TUIApp } from 'rem-agent-tui';
import { AgentClient } from 'rem-agent-sdk';

const server = await createServer(configPath);
await server.start();

const app = new TUIApp({ serverUrl: `http://localhost:${port}`, sessionId });
await app.init();
app.start();
```

---

## 8. 错误处理

| 场景 | 处理 |
|------|------|
| LLM 调用失败 | `ReactLoop` 内部最多重试 3 次，失败后 SSE 发送 `error` 事件 |
| 工具执行失败 | 工具结果中带 `error` 字段，不中断循环 |
| 预算超限 | SSE 发送 `finish` 事件，content 中包含提示 |
| 客户端断连 | Server 收到 Abort → `AbortController.abort()` → `runAgent` 提前返回 |
| Server 重启 | Session 数据持久化在 `SessionProvider` 中，重启后加载恢复 |

---

## 9. 测试

| 层 | 测试内容 | 方式 |
|------|---------|------|
| Core | `runAgent()` 函数行为 | 单元测试，mock ProviderManager |
| Server | HTTP API 请求/响应 | 集成测试，使用 supertest 或 fetch |
| SDK | `AgentClient` 方法 | 单元测试，mock fetch/SSE |
| TUI | UI 渲染 | 现有 widget 测试保留 |

---

## 10. 实现步骤

1. **Core 重构** — 创建 `ProviderManager`（复用现有 `ProviderRegistry`），改造 `runAgent()` 纯函数
2. **SDK 包** — 创建新包，实现 `AgentClient` + SSE 解析
3. **Server 包** — 创建新包，实现 HTTP server + 路由
4. **TUI 改造** — 切换到 `AgentClient`，移除 core 依赖
5. **Demo 更新** — 串联 server + TUI 启动
