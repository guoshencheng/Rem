# Runtime Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 修复 Runtime Review 发现的生命周期、Storage 初始化、Context 配置层、工具幂等与工具结果边界问题，并让未知副作用进入可恢复状态。

**Architecture:** 保持 `AgentRuntime` 外层生命周期负责协调 assembly、实际 Storage 和 inner runtime；把配置层合并封装在执行器的 run-scoped `ConfigProvider` 中。工具调用在持久化层按 `(runId, toolCallId)` 先查已有记录，成功结果复用，未确定状态交由恢复语义处理；不把一次性修复逻辑扩散到无关模块。

**Tech Stack:** TypeScript, Vitest, SQLite/Fake RuntimeStorage, `@earendil-works/pi-agent-core`。

---

### Task 1: 补充 Review 回归测试

**Files:**
- Modify: `packages/core/tests/agent-runtime-assembly.test.ts`
- Modify: `packages/core/tests/rem-agent-executor.test.ts`
- Modify: `packages/core/tests/runtime-tool-boundaries.test.ts`
- Create: `packages/core/tests/runtime-review-regressions.test.ts`

- [x] **Step 1: 写生命周期和 Storage 初始化失败测试**

覆盖 `initialize()` 挂起期间 `shutdown()` 的顺序，以及 `createAgentRuntime({ storage })` 必须调用传入 Storage 的 `init()`。

- [x] **Step 2: 写配置层、工具复用与工具结果形状失败测试**

覆盖 config layer 改变 scoped provider 的读取结果；同一 Run/ToolCallId 的已成功调用复用结果而不再次执行；错误 ID/name/非字符串 output 被拒绝。

- [x] **Step 3: 运行 targeted tests 确认当前实现失败**

Run: `pnpm exec vitest run packages/core/tests/runtime-review-regressions.test.ts packages/core/tests/agent-runtime-assembly.test.ts packages/core/tests/rem-agent-executor.test.ts packages/core/tests/runtime-tool-boundaries.test.ts`

Expected: 新增回归断言在修复前失败，其余既有测试保持可运行。

### Task 2: 修复 Runtime 生命周期与实际 Storage 初始化

**Files:**
- Modify: `packages/core/src/assembly/agent-runtime-assembly.ts`
- Modify: `packages/core/src/application/runtime/agent-runtime.ts` only if lifecycle guard requires it
- Modify: `packages/core/tests/agent-runtime-assembly.test.ts`

- [x] **Step 1: 让实际 runtime Storage 参与 assembly 初始化**

当 `options.storage` 与 `assembly.di.storage` 不同，初始化实际 Storage 一次；默认装配不再留下未使用 Storage 的初始化副作用。

- [x] **Step 2: 串行化 initialize/shutdown**

让 shutdown 等待 in-flight initialization settle，并确保初始化完成后不会把已 shutdown 的 runtime 置为 ready、不会启动 Worker 或使用已关闭 Storage。

- [x] **Step 3: 运行生命周期 targeted tests**

Run: `pnpm exec vitest run packages/core/tests/runtime-review-regressions.test.ts packages/core/tests/agent-runtime-assembly.test.ts`

Expected: PASS。

### Task 3: 让 Context configLayers 生效

**Files:**
- Modify: `packages/core/src/execution/rem-agent-executor.ts`
- Create: `packages/core/src/execution/runtime-config-layers.ts` if merge logic needs independent tests
- Modify: `packages/core/tests/runtime-review-regressions.test.ts`

- [x] **Step 1: 定义稳定的层合并规则**

按 priority 稳定排序，深度隔离每层值；Runtime/Definition 基础配置作为低优先级，Context layers 按名称覆盖明确字段，不改变底层 ConfigProvider 的认证和模型注册表引用。

- [x] **Step 2: 将合并结果接入 run-scoped ConfigProvider**

让 `getConfig`、`getBehaviorConfig`、`getCompressionConfig`、`getToolConfig` 和相关读取使用同一不可变合并快照。

- [x] **Step 3: 运行配置层 targeted tests**

Run: `pnpm exec vitest run packages/core/tests/runtime-review-regressions.test.ts packages/core/tests/rem-agent-executor.test.ts`

Expected: PASS。

### Task 4: 实现 ToolInvocation 成功结果复用与结果边界校验

**Files:**
- Modify: `packages/core/src/sdk/runtime-storage-repositories.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/runtime-tool-invocation-repository.ts`
- Modify: `packages/core/tests/helpers/fake-runtime-store.ts`
- Modify: `packages/core/src/execution/recording-tool-provider.ts`
- Modify: `packages/core/tests/runtime-review-regressions.test.ts`

- [x] **Step 1: 增加按 Run/ToolCallId 查询的 Repository 契约**

Fake 与 SQLite 使用同一查询语义，避免直接依赖 `listByRun` 扫描全部历史。

- [x] **Step 2: 在 planned 插入前实现复用/冲突决策**

相同 toolCallId 且输入一致时复用 `succeeded` 结果；输入不同返回稳定冲突；`executing`、`unknown` 不伪造成功，交给明确恢复策略。

- [x] **Step 3: 校验底层 ToolResult**

要求返回 ID/name 与请求一致、output 为字符串、details 可 canonical clone；不合法结果写失败事件并抛 `TOOL_EXECUTION_FAILED`。

- [x] **Step 4: 运行工具 targeted tests**

Run: `pnpm exec vitest run packages/core/tests/runtime-review-regressions.test.ts packages/core/tests/runtime-tool-boundaries.test.ts packages/core/tests/rem-agent-executor.test.ts packages/core/tests/sqlite-runtime-store.test.ts`

Expected: PASS。

### Task 5: 收敛未知副作用的 Run 状态

**Files:**
- Inspect/modify: `packages/core/src/execution/run-outcome-persistence.ts`
- Inspect/modify: `packages/core/src/execution/local-worker.ts`
- Modify: `packages/core/tests/rem-agent-executor-fatal.test.ts`
- Create/modify: `packages/core/tests/runtime-review-regressions.test.ts`

- [x] **Step 1: 明确 abort/timeout 后 ToolInvocation=unknown 的 Run 语义**

对于工具已开始执行且结果未知的情况，Run 进入 `waiting` 并保留可恢复信息；工具未开始执行的普通取消仍可进入 `cancelled`。

- [x] **Step 2: 增加恢复/查询回归测试**

断言 unknown 不会被错误覆盖成普通 terminal failure，且恢复扫描能够重新暴露该 Run。

- [x] **Step 3: 运行执行恢复 targeted tests**

Run: `pnpm exec vitest run packages/core/tests/rem-agent-executor-fatal.test.ts packages/core/tests/runtime-recovery.test.ts packages/core/tests/runtime-review-regressions.test.ts`

Expected: PASS。

### Task 6: 全量验证

- [x] **Step 1:** `pnpm --filter rem-agent-core build`
- [x] **Step 2:** `pnpm typecheck`
- [x] **Step 3:** `pnpm test -- --runInBand`（并使用单进程分组方式复核 Core 89/1343 与 Web 12/44）
- [x] **Step 4:** `pnpm check:structure && git diff --check`
- [x] **Step 5:** 审核 diff，确认无 archive 修改、无未覆盖的公共 API 变更。
