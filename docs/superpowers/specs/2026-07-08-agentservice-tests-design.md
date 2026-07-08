# AgentService 单元测试补全设计

## 背景

`packages/bridge/src/agent.ts` 中的 `AgentService` 目前对外暴露 15 个方法/属性，但多个核心方法缺少单元测试：

- `interrupt()`、`reset()` 完全未测。
- `run()` 只有立即 resolve 和并发 409 两个用例，核心驱动流程被 `.skip`。
- `stream()` 只测了手工构造快照 + 一个合成事件。
- `listPendingApprovals()`、`resolveApproval()` 所在整份测试文件被 `.skip`。

本次目标是为 `AgentService` 所有对外函数补充单元测试，行覆盖率达到 90% 以上。

## 目标

1. `AgentService` 所有 `IAgentService` 公开方法都有有意义测试用例。
2. `packages/bridge/src/agent.ts` 行覆盖率 ≥ 90%。
3. 废弃并重写现有 `.skip` 测试。
4. 建立清晰的测试目录结构，便于后续渐进维护。

## 设计决策

### 测试策略：Mock Provider 分层验证

- **主流场景不 stub `coreRunAgent`**：让 `AgentService` 真实调用 `buildAgentContext` 和 `runAgent`，仅把 LLM 层替换为 mock provider。
- Provider 自身逻辑由 `rem-agent-core` 的独立测试保证；bridge 层只验证 `AgentService` 与 provider 的调用契约和状态管理。
- 对于 `stream()`、`interrupt()`/`reset()` 等需要精确控制运行时状态的场景，可直接操作 `service.state`（`AgentState`）注入事件和状态。
- **例外**：`run()` 的同步抛错路径可用 `vi.spyOn(rem-agent-core, 'runAgent').mockImplementationOnce(...)` 临时 stub，以稳定触发 `catch` 分支。

### 文件组织：新建 `agent-service/` 目录并一次性迁移

新建 `packages/bridge/tests/agent-service/` 目录，按主题拆分测试文件，并删除旧的 `agent-service*.test.ts` 文件。

```
packages/bridge/tests/
├── agent-service/
│   ├── init.test.ts
│   ├── session.test.ts
│   ├── run.test.ts
│   ├── interrupt-reset.test.ts
│   ├── stream.test.ts
│   └── approval.test.ts
├── client.test.ts
```

### Getter 策略

`context` 和 `state` getter 没有业务逻辑，由其他测试间接覆盖，不单独添加用例。

### `ensureInitialized()` 守卫策略

在 `init.test.ts` 中用参数化测试一次性遍历所有调用守卫的公开方法，确保统一返回 503。

## 目录结构与文件职责

| 文件 | 职责 |
|------|------|
| `init.test.ts` | `init()`、幂等性、`ensureInitialized()` 参数化守卫 |
| `session.test.ts` | 会话 CRUD、`getMessages`、持久化、404 边界 |
| `run.test.ts` | `run()` 正常流、错误流、并发、同步抛错 |
| `interrupt-reset.test.ts` | `interrupt()` 与 `reset()` 的状态转换和边界 |
| `stream.test.ts` | `stream()` 快照回放、多订阅者、workspace 过滤、取消订阅 |
| `approval.test.ts` | `listPendingApprovals()`、`resolveApproval()` 的 wrapper 契约 |
| `shared.ts` | 共享 helper：临时目录、mock provider、bus 事件收集 |

## 各文件测试用例

### `init.test.ts`

- `init() builds AgentContext and enables session operations`
- `init() is idempotent`
- `ensureInitialized() throws 503 for all public methods before init`
  - 参数化遍历：`run`, `interrupt`, `reset`, `createSession`, `listSessions`, `getMessages`, `updateSession`, `deleteSession`, `stream`, `listPendingApprovals`, `resolveApproval`

### `session.test.ts`

- `createSession() returns summary with default title and zero messages`
- `listSessions() sorts pinned first, then by updatedAt desc`
- `updateSession() updates title and pinned, refreshes updatedAt`
- `deleteSession() removes session`
- `getMessages() returns empty array for new session`
- `getMessages() merges tool-result into assistant message`
- `deleteSession() / getMessages() / updateSession() throw 404 for non-existent session`
- `sessions persist across new AgentService instances using same sessionsDir`

### `run.test.ts`

- `run() resolves immediately and starts background drive`
- `run() rejects concurrent run with 409`
- `run() publishes session-start, chunks, session-end via bus`
- `run() calls finishRun on normal completion`
- `run() publishes session-error when drive throws`
- `run() handles synchronous throw from coreRunAgent`
- `run() consumes fullStream until finish chunk`

### `interrupt-reset.test.ts`

- `interrupt() aborts run but does not finish it`
- `reset() aborts run and finishes it`
- `reset() clears snapshot and runController`
- `interrupt() is safe when session not running`
- `reset() is safe when session not running`

### `stream.test.ts`

- `stream() replays snapshots for running sessions`
- `stream() yields live bus events after snapshot replay`
- `stream() filters events by workspace`
- `stream() supports multiple concurrent subscribers`
- `stream() unsubscribes on break/return`
- `stream() replays no snapshots when no sessions running`

### `approval.test.ts`

- `listPendingApprovals() returns pending requests from AgentState`
- `resolveApproval() resolves pending approval and returns true`
- `resolveApproval() returns false for unknown approvalId`

> 审批生命周期（emit `approval-request` chunk、等待决策、发布 `approval-resolved`）由 `rem-agent-core` 的 `execute-tools` 负责，不在 bridge 层做端到端测试。

## 共享 Helper（`shared.ts`）

新增 `packages/bridge/tests/agent-service/shared.ts`，提供：

- `registerMockProvider(name, stream?, generate?)` — 注册 mock provider，并在 `afterEach` 自动 `clearProviders()`。
- `createTestService({ workspace?, provider?, ... })` — 创建临时目录、`AgentService`、`init()`，返回 `{ service, dir, cleanup }`。
- `collectBusEvents(service, sessionId?)` — 返回 `{ events, stop }`，用于收集 bus 事件。
- `waitFor(events, predicate, timeout?)` — 轮询等待事件列表满足条件。
- `buildStreamFromChunks(chunks)` — 把数组转成 `AsyncGenerator<AgentStreamChunk>`，方便 mock provider。

## 覆盖率目标与验证

- **目标**：`packages/bridge/src/agent.ts` 行覆盖率 ≥ 90%。
- **验证命令**：
  - `pnpm --filter rem-agent-bridge test`
  - 可选：`pnpm --filter rem-agent-bridge test -- --coverage`
- **质量门**：实现完成后运行 `pnpm typecheck && pnpm test`，确保无 `.skip`、无失败。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 迁移导致旧测试历史丢失 | 新测试保留并扩展所有旧场景 |
| mock provider 与真实 provider 行为偏离 | 明确分层：provider 逻辑由 `rem-agent-core` 自身测试保证 |
| `stream()` 异步测试不稳定 | 用 `queueMicrotask` + 显式迭代器控制，避免真实时间等待 |

## 废弃内容

以下文件将被删除：

- `packages/bridge/tests/agent-service.test.ts`
- `packages/bridge/tests/agent-service-init.test.ts`
- `packages/bridge/tests/agent-service-run.test.ts`
- `packages/bridge/tests/agent-service-stream.test.ts`
- `packages/bridge/tests/agent-service-approval.test.ts`
