# 移除 AgentService / ProviderManager 单例设计

## 背景

当前 `AgentService` 和 `ProviderManager` 都使用单例模式，带来以下问题：

- **AgentService**（`packages/bridge/src/agent.ts`）通过 `globalThis._remBridgeAgentService` 实现全局单例，但 server 又用 `new AgentService()` 绕过，与 web 路由的 `getInstance()` 不在同一实例。同时 `applyChunk` 方法在 route 层每 chunk 调用攒消息，逻辑分散且职责不清。
- **ProviderManager**（`packages/core/src/provider-manager.ts`）通过 `private static instance` 实现类级单例，同时充当全局服务定位器（`pm.require('tool')` 等），`runAgent()` 内部到处 `ProviderManager.getInstance()` 捞依赖。

本设计将两个类改为普通实例，通过 awilix DI 容器统一管理。同时删除 `packages/server`。

## 目标

1. 引入 [awilix](https://github.com/jeffijoe/awilix) 作为 DI 容器，统一管理依赖生命周期。
2. `ProviderManager` 作为普通实例，容器启动时创建并注册。
3. `AgentService` 作为普通实例，构造函数接收 `ProviderManager`，去掉 `applyChunk()`，消息折叠内聚到 `run()` 内部。
4. `SessionService` 构造注入 `AgentService`，`list()` 委托给 `agentService.listSessions()`，不再强转访问 `msgCache`。
5. `runAgent()` 显式接收 `ProviderManager` 作为参数，不再调用 `getInstance()`。
6. 删除 `packages/server` 目录。

## 非目标

- 改动 `rem-agent-tui` 或 `rem-agent-demo`。
- 修改 provider 加载/注册机制本身。

## 关键设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| DI 方式 | awilix 容器 | 轻量、无装饰器、原生支持异步工厂；项目依赖数不多，awilix 够用。 |
| ProviderManager 生命周期 | 容器 SINGLETON | 启动时初始化一次，后续请求复用同一实例。 |
| 消息折叠位置 | `AgentService.run()` 内部 | 避免 route 层每次 chunk 手动调 `applyChunk`；消息构建本就是 service 职责。 |

## 组件变更

### ProviderManager (`packages/core/src/provider-manager.ts`)

- 移除 `private static instance`、`static getInstance()`、`static resetInstance()`
- `initialize()` 改为公开的 `async init()`
- 导出工厂函数：

```typescript
export async function createProviderManager(config?: ProviderManagerConfig): Promise<ProviderManager> {
  const pm = new ProviderManager(config ?? {});
  await pm.init();
  return pm;
}
```

### AgentService (`packages/bridge/src/agent.ts`)

- 移除 `static getInstance()`、`_remBridgeAgentService` 全局变量
- 构造函数改为 `constructor(providerManager: ProviderManager)`（参数名须匹配容器注册名）
- 移除 `ensureProviderManager()` — pm 已由外部传入
- 移除 `applyChunk()`、`msgCache` 字段
- `run()` 内部改为：
  1. 防并发检查（已有逻辑保留）
  2. 调用 `coreRunAgent({...}, pm)` 传入 pm
  3. 用 tap 模式包装 `fullStream`：每个 chunk 同时攒 `ServerMessage[]` + 推入一个新的 `ReadableStream`
  4. `activeStreams` 存这个 `ReadableStream`（SSE 路由直接消费，无需 `applyChunk`）
  5. 流结束/出错时 `sessionProvider.cueMessages()` 持久化
  6. 返回 `{ sessionId }`（接口不变）
- 新增 `listSessions(): { sessionId, title, messageCount }[]` 方法，内部走 `sessionProvider` 遍历已有 session

### SessionService (`packages/bridge/src/sessions.ts`)

- 构造函数改为 `constructor(agentService: AgentService)`（参数名须匹配容器注册名）
- `list()` 改为 `this.agentService.listSessions()`
- 移除对 `msgCache` 的类型强转 `(agentSvc as any).msgCache`

### runAgent (`packages/core/src/run-agent.ts`)

- 参数增加 `pm: ProviderManager`
- 移除内部 `await ProviderManager.getInstance()` 调用
- 所有 `pm.require('session')` 等调用使用传入的 pm 实例

### 容器配置 (`packages/web/src/lib/container.ts`，新增)

```typescript
import { createContainer, asValue, asClass, asFunction, Lifetime } from 'awilix';
import { createProviderManager, ProviderManager } from 'rem-agent-core';
import { AgentService, SessionService } from 'rem-agent-bridge';

async function buildProviderManager() {
  return await createProviderManager({ /* config */ });
}

export async function configureContainer() {
  const container = createContainer();

  container.register({
    providerManager: asFunction(buildProviderManager, { lifetime: Lifetime.SINGLETON }),
    agentService: asClass(AgentService, { lifetime: Lifetime.SINGLETON }),
    sessionService: asClass(SessionService, { lifetime: Lifetime.SINGLETON }),
  });

  return container;
}
```

awilix 通过构造函数参数名自动匹配注册名，因此 `AgentService` 的构造函数参数需命名为 `providerManager`（与容器注册名一致），而非 `pm`。同理 `SessionService` 的构造函数参数需命名为 `agentService`。

路由层通过 `container.resolve('agentService')` 获取实例。

`AgentService` 和 `SessionService` 的构造函数中 **禁止** 从容器解析其他依赖——仅存储传入参数，依赖全部在容器注册时由 awilix 自动注入。

### Web 路由层

**`packages/web/src/app/api/agent/run/route.ts`**：
- 从容器解析 `agentService`，不再 `AgentService.getInstance()`

**`packages/web/src/app/api/stream/[sessionId]/route.ts`**：
- 从容器解析 `agentService`
- 移除 `agentService.applyChunk(sessionId, chunk)` 调用

**`packages/web/src/app/api/sessions/route.ts`**、**`packages/web/src/app/api/sessions/[id]/route.ts`**：
- 从容器解析 `sessionService`，不再 `new SessionService()`

### Server (`packages/server/`)

- 删除整个目录

## 数据流

```text
应用启动
  │
  ▼
configureContainer()
  ├── createProviderManager(config)
  │     └── new ProviderManager() + await pm.init()
  │           ├── registerBuiltInProviders (openai, anthropic)
  │           ├── 读取配置文件 (YAML/JSON)
  │           ├── 创建 ConfigProvider
  │           └── 加载 7 个 provider
  │
  ├── container.register({ providerManager: asFunction(buildProviderManager, SINGLETON) })
  ├── container.register({ agentService: asClass(AgentService, SINGLETON) })
  └── container.register({ sessionService: asClass(SessionService, SINGLETON) })
  │
  ▼
路由 resolve：
  const agentService = container.resolve('agentService')
  const sessionService = container.resolve('sessionService')

HTTP 请求到达：
  agentService.run(params)
    ├── 防并发检查
    ├── coreRunAgent({...}, pm)   ← 传入 pm
    │     ├── 从 pm 取 sessionProvider, toolProvider, memoryProvider 等
    │     └── 返回 RunAgentResult (含 fullStream)
    ├── tap 包装 fullStream → { messageAccumulator, ReadableStream }
    │     ├── 后台任务消费 fullStream，每 chunk：攒 ServerMessage[] + 推入 ReadableStream
    │     └── ReadableStream 存入 activeStreams
    ├── 流结束/出错时 sessionProvider.cueMessages()
    └── 返回 { sessionId }

SSE 路由：
  agentService.getStream(sessionId) → ReadableStream
    └── 直接 pipe 到 SSE 客户端（不再调 applyChunk）

## 边界情况

| 场景 | 行为 |
|------|------|
| ProviderManager init 失败 | 启动时抛异常，应用直接失败；不会在请求处理中暴露。 |
| 同一 session 并发 run | `activeRuns.has(sessionId)` 检查保留，返回 409。 |
| 流未结束时 session 被 reload | `getMessages()` 从 `sessionProvider.pullMessages()` 获取已持久化的消息；当前流中的消息尚未 `cueMessages`，不包含在结果中。 |
| SessionService.list() 无会话 | 返回空数组。 |

## 测试策略

- **ProviderManager**：`packages/core/tests/provider-manager.test.ts` — 去掉对 `getInstance()` / `resetInstance()` 的调用，改为手动 `createProviderManager()` + `new ProviderManager()` 测试。
- **AgentService**：新增 `packages/bridge/tests/agent.test.ts` — 测试 `run()` 内部消息折叠、`listSessions()`。
- **SessionService**：`list()` 改为 mock `AgentService` 测试。
- **runAgent**：`packages/core/tests/run-agent.test.ts` — 改为传入 `pm` 参数。
- **容器**：验证 awilix 能正确解析 `AgentService` → `ProviderManager`、`SessionService` → `AgentService` 的依赖链。

## 依赖与影响范围

| 包 | 影响 |
|----|------|
| `packages/core` | `provider-manager.ts`、`run-agent.ts`、`index.ts` 导出、测试 |
| `packages/bridge` | `agent.ts`、`sessions.ts`、`index.ts` 导出、测试 |
| `packages/web` | `lib/container.ts`（新增）、`app/api/agent/run/route.ts`、`app/api/stream/[sessionId]/route.ts`、`app/api/sessions/route.ts`、`app/api/sessions/[id]/route.ts`，新增 `awilix` 依赖 |
| `packages/server` | 删除 |
