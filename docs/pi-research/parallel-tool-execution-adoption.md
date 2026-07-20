# REM 借鉴 PI 并行工具执行设计的调研报告

> 调研目标：评估将 PI (`@earendil-works/pi-agent-core`) 的并行工具执行机制引入 REM 核心 (`rem-agent-core`) 的可行性，并提出对 `execute-tools.ts` 的升级方案。
>
> 调研范围：
> - REM：`packages/core/src/execute/execute-tools.ts` 及其周边（approval、security rule、workspace guard、tool provider、agent state）
> - PI：`packages/agent/README.md`、`packages/agent/src/agent-loop.ts`、`packages/agent/src/types.ts`
> - 时间：2026-07-15

---

## 1. 执行摘要：结论与推荐方案

REM 当前 `execute-tools.ts` 是**纯串行**实现：每个 `ToolCall` 按顺序完成“查找定义 → 权限评估 → 审批等待 → 安全分类 → 执行 → 结果回显”的全流程后，才进入下一个工具。该设计在单步多工具场景（如一次 LLM 响应同时请求“读取 3 个文件”或“并发搜索多个目录”）中会造成不必要的等待，尤其是审批阻塞时问题更明显。

PI 的 `agent-loop.ts` 采用 **preflight + parallel/sequential 混合执行**模型：
- 默认 `parallel`：先按顺序对每把工具做校验和前置检查（preflight），再并发执行获准的工具；
- 支持全局 `toolExecution` 配置与 per-tool `executionMode` 覆盖；
- 通过 `beforeToolCall`/`afterToolCall` hooks 在前后插入阻塞/改写逻辑；
- 并发执行完成事件按完成顺序发出，但最终的 `toolResult` 消息按 assistant 源顺序写入 transcript；
- 工具结果可携带 `terminate` hint，当整批工具都返回 `terminate: true` 时跳过下一次 LLM 调用。

**推荐方案**：在 REM 中引入 **分阶段执行引擎**。
1. 将一次工具批次拆分为 **preflight（顺序）** 与 **execution（可并发）** 两个阶段；
2. 在 preflight 中整合现有 permission evaluator、approval engine、workspace guard、security rules，并新增 `beforeToolCall` hook；
3. 在 execution 中根据工具依赖关系和 `executionMode` 决定并发或串行；
4. 执行完成后通过 `afterToolCall` hook 做结果改写、终止提示、审计标记；
5. 最终仍按 assistant 请求顺序生成 `tool-result` 消息并持久化，保证 LLM 上下文顺序。

实施方式建议**分阶段迁移**：先类型与接口扩展，再并行引擎（默认关闭），最后切换默认并补齐 hooks、terminate hint。这样可以在不破坏现有测试和 UI 流式假设的前提下逐步验证。

---

## 2. REM 当前工具执行的问题

### 2.1 纯串行执行

`execute-tools.ts` 第 49 行起的 `for...of` 循环决定了行为：

```typescript
for (const tc of params.toolCalls) {
  // 1. 查找定义
  // 2. 权限评估（可能阻塞等待审批）
  // 3. 安全分类 + outsideAllowed 计算
  // 4. toolProvider.execute([tc], ctx)  // 始终只传单个 call
  // 5. emitToolResult 并写入 message
  // 然后才进入下一个 tc
}
```

即使是互相独立的读操作（`read fileA`、`read fileB`、`read fileC`），也必须一个等一个完成。虽然 `AgentToolRegistry.execute` 接受 `ToolCall[]` 数组（`tool-registry.ts` 第 68 行），但 `execute-tools.ts` 永远只传 `[tc]`，没有发挥批量执行潜力。

### 2.2 审批阻塞整批工具

当 `permissionEvaluator.evaluate` 返回 `action: 'ask'` 时，当前实现会：
1. 创建 approval request；
2. 将其压入 `liveState.pendingApprovals`；
3. 发出 `approval-request` chunk；
4. `await liveState.approvalEngine.wait(...)` 阻塞，直到用户/规则解析；
5. 该工具执行完毕并 emit 结果后，才处理下一个 `ToolCall`。

这意味着一个批次的多个工具只能**串行等待审批**。即使多个工具都需要审批，也无法一次性展示全部待审批项并并行等待用户决策。更关键的是，如果用户长时间未响应，整个 agent 运行都会挂起。

### 2.3 性能瓶颈与活动状态不一致

`AgentLiveState.applyChunk`（`state.ts` 第 175 行）通过 `pendingToolCalls` 集合跟踪“当前正在执行的工具”。在串行模式下，集合中最多只有一个 id；但在未来并行模式下，必须能正确跟踪多个 id 的增删，否则 `activity` 会在部分工具完成时错误地切换到 `idle`/`outputting`。

此外，当前 `emitToolResult`（`execute-tools.ts` 第 32 行）在**每个工具执行完毕后立即 emit `tool-result`** 并追加到 message。如果后续改为并发，完成顺序可能与 assistant 请求顺序不同，需要明确“事件顺序”与“transcript 顺序”的分离策略。

### 2.4 缺少 hooks 与终止提示

REM 当前没有任何 `beforeToolCall`/`afterToolCall` 扩展点。`ToolResult` 只有 `toolCallId`、`toolName`、`output`、`error`、`details`，没有：
- 提前终止本轮的 `terminate` hint；
- 运行时强制某工具串行的 `executionMode`；
- 执行后对结果做审计/脱敏/截断的 hook。

这些限制让 REM 难以实现 PI 所支持的“工具执行完成后跳过 LLM 后续调用”等高级行为。

---

## 3. PI 的设计可借鉴点

### 3.1 parallel/sequential 执行模式

PI 在 `types.ts` 中定义：

```typescript
export type ToolExecutionMode = "sequential" | "parallel";
```

并在 `AgentTool` 上支持 per-tool 覆盖：

```typescript
export interface AgentTool<...> extends Tool<...> {
  executionMode?: ToolExecutionMode;
}
```

`executeToolCalls`（`agent-loop.ts` 第 413 行）决策逻辑：

```typescript
const hasSequentialToolCall = toolCalls.some(
  (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
);
if (config.toolExecution === "sequential" || hasSequentialToolCall) {
  return executeToolCallsSequential(...);
}
return executeToolCallsParallel(...);
```

**借鉴价值**：REM 可以引入同样的 `executionMode` 概念，让写工具（`write`、`edit`）或具有资源依赖的工具强制串行，而大量读工具（`read`、`grep`、`list`）默认并行。

### 3.2 beforeToolCall / afterToolCall hooks

`AgentLoopConfig`（`types.ts` 第 140 行）提供两个扩展点：

```typescript
beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
```

`beforeToolCall` 在参数校验后执行，可返回 `{ block: true, reason }` 阻止工具执行；`afterToolCall` 在工具返回后执行，可覆盖 `content`、`details`、`isError`、`terminate`。

**借鉴价值**：REM 的 permission evaluator、workspace guard、dangerous tool classifier 都可以映射到 `beforeToolCall` 阶段；审批阻塞也可以在这里统一处理。`afterToolCall` 则可以用于：
- 工具结果截断/脱敏；
- 审计日志写入；
- 根据结果决定 `terminate`。

### 3.3 preflight 与执行分离

`prepareToolCall`（`agent-loop.ts` 第 602 行）完成：
1. 查找工具；
2. `prepareArguments`（可选 shim）；
3. `validateToolArguments`；
4. `beforeToolCall` hook；
5. 返回 `PreparedToolCall` 或立即失败的 `ImmediateToolCallOutcome`。

`executeToolCallsParallel`（第 491 行）先顺序调用 `prepareToolCall`，将结果收集为 `FinalizedToolCallEntry[]`（有些是立即失败的 outcome，有些是待执行的 async thunk），然后：

```typescript
const orderedFinalizedCalls = await Promise.all(
  finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
);
```

**借鉴价值**：将 REM 的“查找定义、权限评估、审批、分类”前置到 preflight，只有真正需要执行的工具才进入并发阶段。这样审批仍然是顺序、可预测的，但 I/O 密集型工具可以并发运行。

### 3.4 工具结果顺序保证

PI 明确区分两类顺序：
- `tool_execution_end` 事件按工具完成顺序发出；
- `toolResult` 消息（写入 transcript 给 LLM 看）按 assistant source 顺序发出。

在 `executeToolCallsParallel` 中，即使先完成 fileC 的读取，最终也会按 `fileA → fileB → fileC` 的 assistant 请求顺序生成 `toolResult` 消息。

**借鉴价值**：REM 的 `emitToolResult` 当前是“完成一个 emit 一个”。未来需要保留流式事件顺序（让用户看到谁先完成），但持久化到 `ModelMessage` 时必须按源顺序排列，否则 LLM 可能把结果张冠李戴。

### 3.5 terminate hint

`AgentToolResult` 包含：

```typescript
terminate?: boolean;
```

`shouldTerminateToolBatch`（第 584 行）判定：

```typescript
return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
```

只有整批工具都同意终止时，才跳过下一次 LLM 调用。`afterToolCall` 也可以返回 `terminate` 覆盖工具自身结果。

**借鉴价值**：REM 的 `ToolResult` 可以扩展 `terminate?: boolean`，`ReactLoop` 在 `ctx.execute()` 返回后检查是否全部 `terminate`，若是则直接结束本轮，不继续调用 LLM。这对“通知完成”类工具非常有用。

---

## 4. 推荐的新设计

### 4.1 总体架构

将 `execute-tools.ts` 重构为 **ExecuteToolsEngine**，核心流程如下：

```
toolCalls (assistant source order)
  │
  ▼
[Phase 1: Preflight]  ← 顺序执行，可能阻塞审批
  ├─ 查找 ToolDefinition
  ├─ permissionEvaluator.evaluate (rules, security mode)
  ├─ approval wait (if ask)
  ├─ workspace guard / outsideAllowed 计算
  ├─ beforeToolCall hook
  └─ 输出：PreparedToolCall | ImmediateToolResult
  │
  ▼
[Phase 2: Execution]
  ├─ 若任一为 sequential 或全局 sequential → 串行执行
  └─ 否则 → 并发执行所有 PreparedToolCall
  │
  ▼
[Phase 3: Finalization]
  ├─ afterToolCall hook（按源顺序或完成顺序均可，建议完成顺序）
  ├─ 计算 terminate
  └─ 按 assistant source order 输出 ToolResult[]
  │
  ▼
[Phase 4: Emission]
  ├─ emit tool-result-start / tool-result / tool-result-finish（完成顺序）
  └─ 按 assistant source order appendContent 到 tool message
```

### 4.2 与现有 approval 集成

审批仍然放在 **preflight 阶段**，顺序执行。原因：
1. 审批通常需要展示上下文（工具名、参数、pattern），如果多个审批同时弹出，UI 需要同时展示多个 request；
2. 规则可能因 `allow-always` 而动态写入 `ruleStore` 并 `ruleEngine.addRule`，顺序执行可以避免并发写规则带来的竞态；
3. 与 PI 的 preflight 模型保持一致，降低理解成本。

但可以在 preflight 内部做一个小优化：一次性将多个需要 `ask` 的 request 创建出来，全部 push 到 `pendingApprovals`，然后 `Promise.all` 等待它们全部解析。这样用户可以在 UI 里看到一整批审批，而不是一个个弹出。这是 REM 相对 PI 可以改进的地方（PI 也是顺序 preflight，但并未显式批量等待审批）。

### 4.3 与 security rule / workspace guard 集成

- `permissionEvaluator.evaluate` 和 `ruleEngine` 保持现有接口不变，在 preflight 中调用；
- `classifyTool` + `computeOutsideAllowed` 逻辑也移到 preflight；
- 如果工具执行时仍抛出 `WorkspaceOutsideError`（例如动态解析路径），在 `afterToolCall` 或执行阶段错误处理中触发第二次审批，与当前 `handleOutsideWorkspaceError` 行为一致；
- 由于并发执行时多个工具可能同时触发 outside 错误，审批 engine 需要支持多个并发 pending approvals（当前 `ApprovalEngine` 使用 `Map<string, ...>`，天然支持）。

### 4.4 执行模式决策

新增 `ToolExecutionMode` 类型并支持 per-tool 覆盖：

```typescript
export type ToolExecutionMode = 'sequential' | 'parallel';

export interface ToolDefinition<T extends TObject = TObject> {
  // ... 原有字段
  /** 覆盖该工具的执行模式；默认使用全局配置。 */
  executionMode?: ToolExecutionMode;
}
```

在 `ExecuteParams` 中增加全局配置：

```typescript
export interface ExecuteParams {
  // ... 原有字段
  toolExecution?: ToolExecutionMode; // 默认 'sequential'（向后兼容）
  beforeToolCall?: (ctx: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (ctx: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}
```

决策函数：

```typescript
function shouldRunSequential(toolCalls: ToolCall[], toolProvider: ToolProvider, mode: ToolExecutionMode): boolean {
  if (mode === 'sequential') return true;
  return toolCalls.some((tc) => toolProvider.getToolDefinition(tc.toolName)?.executionMode === 'sequential');
}
```

### 4.5 工具结果顺序与 emit 策略

引入 **ToolCallSlot** 概念：每个源顺序位置都是一个 slot，最终 `results` 数组按 slot 顺序返回。执行阶段可以并发填充 slot，但 Phase 3 按 slot index 组装输出。

emit 策略：
- 工具实际开始执行时 emit `tool-result-start`；
- 工具完成并通过 `afterToolCall` 后 emit `tool-result`（包含最终 output/error）；
- 最终按源顺序 append content 到 tool message，确保 `ModelMessage` 顺序与 assistant 请求一致。

这样 UI 可以看到“fileC 先完成”的实时反馈，但 LLM 拿到的上下文仍是正确顺序。

### 4.6 terminate hint 集成

扩展 `ToolResult`：

```typescript
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  error?: string;
  details?: unknown;
  terminate?: boolean;
}
```

`executeTools` 返回 `ToolResult[]` 后，`ReactLoop`（或 `runAgent` 的循环调用方）判断是否全部 `terminate`：

```typescript
const shouldTerminate = results.length > 0 && results.every((r) => r.terminate === true);
if (shouldTerminate) {
  // 结束循环，不再调用 LLM
}
```

PI 的 `shouldStopAfterTurn` 也能提供类似能力，但 `terminate` 更适合工具自身表达意图（如 `notify_done`）。

---

## 5. 变更清单

### 5.1 新增文件

| 文件 | 说明 |
|------|------|
| `packages/core/src/execute/tool-execution-types.ts` | `ToolExecutionMode`、`BeforeToolCallContext`、`AfterToolCallContext`、`BeforeToolCallResult`、`AfterToolCallResult`、`PreparedToolCall` 等类型 |
| `packages/core/src/execute/execute-tool-call.ts` | 单个 `ToolCall` 的 preflight/execute/finalize 辅助函数，便于拆分和单测 |
| `packages/core/src/execute/execute-tool-batch.ts` | 串行/并行批次的调度逻辑 |
| `packages/core/tests/execute/execute-tools-parallel.test.ts` | 并行执行、terminate、afterToolCall 等测试 |

### 5.2 修改文件

| 文件 | 修改点 |
|------|--------|
| `packages/core/src/sdk/tool-provider.ts` | 1. `ToolDefinition` 增加 `executionMode?: ToolExecutionMode`；2. `ToolResult` 增加 `terminate?: boolean`、`details?: unknown`（已存在） |
| `packages/core/src/execute/execute-tools.ts` | 主重构：拆分为 preflight + execute + finalize + emit 四阶段；实现 `executeToolBatchSequential` / `executeToolBatchParallel`；集成 before/after hooks；保持返回 `ToolResult[]` 的接口签名 |
| `packages/core/src/execute/approval-engine.ts` | 可选：增加 `waitMany(ids)` 或保持现有 `wait` 多次调用；确认 `Map` 并发安全 |
| `packages/core/src/agent-state.ts` | 无强制修改，但需确认 `pendingToolCalls` 在并发下的正确性 |
| `packages/core/src/state.ts` | `applyChunk` 已支持 `pendingToolCalls` 集合，需确保 `tool-result-start` 等新增 chunk 类型也更新集合；注意并发完成时 activity 不提前切到 idle |
| `packages/core/src/run-agent.ts` | 在构建 `LoopContext.execute` 时传入 `toolExecution`、`beforeToolCall`、`afterToolCall`（来自 `AgentContext` 或 behavior config） |
| `packages/core/src/agent-context.ts` | 若需要让上层注入 hooks，则扩展 `AgentContext` 或 `ConfigProvider` 的 behavior config |
| `packages/core/src/plugins/loop/react/index.ts` | 在 `ctx.execute()` 返回后根据 `terminate` 决定是否终止循环 |
| `packages/core/src/index.ts` | 导出新增类型：`ToolExecutionMode`、`BeforeToolCallResult`、`AfterToolCallResult` 等 |

### 5.3 修改函数/类型签名

| 原签名 | 变更 |
|--------|------|
| `ToolResult` | 增加 `terminate?: boolean` |
| `ToolDefinition<T>` | 增加 `executionMode?: 'sequential' \| 'parallel'` |
| `ExecuteParams` | 增加 `toolExecution?: ToolExecutionMode; beforeToolCall?; afterToolCall?` |
| `executeTools(params)` | 内部逻辑重构，对外返回类型不变 |
| `AgentLiveState.applyChunk` | 可能需要识别 `tool-result-start` 等新的 chunk 类型 |
| `ReactLoop.run` | 读取 `execute()` 返回的 `terminate` 并决定是否结束循环 |

---

## 6. 迁移步骤

### Phase 0：研究与接口草案（1-2 天）

- 完成本报告；
- 在 `tool-provider.ts` 中新增 `ToolExecutionMode` 和 `ToolResult.terminate`；
- 新增 `tool-execution-types.ts`，仅放类型，不改动行为；
- 跑 `pnpm typecheck` 确认无破坏。

### Phase 1：提取单个工具执行逻辑（3-5 天）

- 将 `execute-tools.ts` 中单个 `ToolCall` 的处理逻辑提取到 `execute-tool-call.ts`：
  - `preflightToolCall`：查找、permission、approval、分类、before hook；
  - `executePreparedToolCall`：调用 `toolProvider.execute`；
  - `finalizeToolCall`：after hook、error 归一化；
- 此时仍保持 `execute-tools.ts` 的 `for...of` 串行循环，但每个循环体调用新的辅助函数；
- 增加单元测试覆盖 preflight 各分支（allow/deny/ask/outside/error）。

### Phase 2：并行调度引擎（默认关闭）（5-7 天）

- 实现 `executeToolBatchSequential` 和 `executeToolBatchParallel`；
- 在 `ExecuteParams` 中引入 `toolExecution`，默认 `'sequential'`（向后兼容）；
- 在 `ToolDefinition` 中支持 `executionMode` 覆盖；
- 通过 `shouldRunSequential` 决策；
- 确保并发执行时：
  - abort signal 能正确传播；
  - `emit` 顺序与 `appendContent` 顺序分离；
  - 返回的 `ToolResult[]` 仍按源顺序；
- 新增 `execute-tools-parallel.test.ts` 测试多工具并发、部分失败、abort。

### Phase 3：集成 before/after hooks（3-5 天）

- 在 `ExecuteParams` 中增加 `beforeToolCall`/`afterToolCall`；
- 在 `run-agent.ts` 中从 `ctx.configProvider` 或 `behavior` 读取 hooks；
- 用 hooks 实现现有安全行为的等价替代（可选）：
  - 将 permission evaluator 的部分逻辑通过 `beforeToolCall` 暴露；
  - 将结果截断/审计通过 `afterToolCall` 暴露；
- 增加 hook 测试。

### Phase 4：terminate hint 与循环集成（2-3 天）

- `ToolResult` 增加 `terminate`；
- `ReactLoop` 在 `ctx.execute()` 返回后判断 `results.every(r => r.terminate)`；
- 若全部 terminate，则 `emit step-finish` 并直接返回，不再调用 `ctx.reason()`；
- 对 `notify_done` 等工具做端到端测试。

### Phase 5：默认启用并行（1-2 天）

- 将 `toolExecution` 默认从 `'sequential'` 切换到 `'parallel'`；
- 更新 `execute-tools` 相关测试的期望值；
- 跑全量 `pnpm typecheck && pnpm test`；
- 更新 `docs/architecture.md` 和 `packages/core/README.md` 中关于工具执行的描述。

---

## 7. 安全与一致性考虑

### 7.1 并发下的 approval

- **preflight 阶段仍顺序执行审批**：与 PI 一致，避免多个审批同时弹出导致 UI 混乱，也避免规则写入竞态；
- **批量等待**：可以一次性创建多个 `ask` request，然后 `Promise.all` 等待，提升用户体验；
- **approve-always 规则写入**：需要在 `Promise.all` 解析后按顺序 `ruleStore.saveApproved` + `ruleEngine.addRule`；虽然 `ApprovalEngine` 的 `Map` 是线程安全的，但规则持久化建议串行；
- **denyAll / abort**：`ApprovalEngine.denyAll()` 已遍历 `Map` 解析所有 pending，并发安全。

### 7.2 错误处理

- 单个工具失败（如文件不存在、参数校验失败）不应影响同批次其他工具；
- preflight 阶段立即失败的工具应作为 `ImmediateToolResult` 放入结果数组，不再进入执行阶段；
- 执行阶段抛出的错误应被捕获并转换为 `error` 字段，而不是中断整个批次；
- `AbortSignal` 被触发时，应停止启动新工具，但允许已开始的工具自然结束或自行监听 signal 中断；
- `afterToolCall` 抛错应被视为工具错误，并将 `isError` 置为 true。

### 7.3 工具结果顺序

- **事件顺序**（用户可见）：允许按完成顺序 emit `tool-result`；
- **transcript 顺序**（LLM 可见）：必须按 assistant 源顺序写入 `ModelMessage`；
- 实现技巧：使用 `Map<toolCallId, ToolResult>` 或固定长度数组 `slotResults[i]`，等所有工具完成后再按 `toolCalls[i].toolCallId` 组装最终数组；
- 注意：流式 UI 中用户可能看到 tool result 乱序到达，但后续 LLM 请求时顺序是正确的。

### 7.4 状态与活动状态

- `AgentLiveState.pendingToolCalls` 需要在每个工具开始时 add、完成时 delete；
- 并发时 `activity` 不应因为部分工具完成而提前变为 `idle`/`outputting`；
- 建议新增 `tool-result-start` chunk 类型，在 `applyChunk` 中识别并管理 `pendingToolCalls`；
- 当 `pendingToolCalls.size === 0` 且所有结果都已 emit 后，再考虑切换 activity。

### 7.5 资源依赖与竞态

- 并发工具可能访问同一文件或同一网络资源，需要 per-tool `executionMode` 让有依赖的工具串行；
- 写工具（`write`、`edit`）默认应标记为 `sequential`，避免并发写入同一文件导致内容覆盖；
- 模型被提示“若工具之间存在依赖，请按顺序调用或标记 sequential”；
- 如果未来需要更细粒度，可以增加工具依赖图分析，但超出本次调研范围。

---

## 8. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **测试大量依赖串行顺序** | 现有 `execute-tools-*.test.ts` 测试期望 chunk 按顺序到达，并行后可能失败 | 阶段 2 默认仍 sequential，新增独立并行测试；阶段 5 切换默认时同步更新旧测试 |
| **UI 流式解析假设** | web/tui 可能假设 `tool-result` 与 `tool-call` 一一对应且顺序一致，乱序事件可能导致渲染异常 | 保持 `appendContent` 按源顺序；事件 emit 可乱序但需 UI 侧测试；必要时新增 `tool-result-start` 帮助 UI 跟踪 |
| **文件系统并发竞态** | 多个 `read`/`write` 同时操作同一文件可能产生不一致结果 | 写工具默认 `executionMode: 'sequential'`；auto 模式下不并发危险写工具 |
| **审批 UX 复杂化** | 并行 preflight 批量产生多个 approval request，用户可能一次性收到多个弹窗 | 在 UI 层支持“批量审批”面板；core 层一次性 emit 多个 approval-request 后 `Promise.all` 等待 |
| **AbortSignal 处理不当** | 并发时 abort 后仍有工具继续运行，可能产生幽灵副作用 | 工具实现自身监听 signal；preflight 检查 signal.aborted；执行阶段不再启动新工具但等已启动的 settle |
| **API 向后兼容** | `ToolResult` 增加 `terminate` 可能影响序列化或外部依赖 | `terminate` 为可选字段，不破坏现有结构；JSON 序列化时忽略 undefined |
| **消息持久化顺序** | 如果按完成顺序 `appendContent`，LLM 会拿到错误顺序 | 必须按 `toolCalls` 源顺序写入 message，不能按完成顺序 |
| **RuleEngine 并发规则写入** | 多个 `allow-always` 同时 `addRule` 可能触发数组 push 竞态 | 在 preflight 或 finalize 阶段串行化规则写入；`Promise.all` 解析后顺序执行 |
| **工具执行耗时差异** | 一个慢工具会阻塞整批 terminate 判断 | 这是预期行为；`terminate` 只在所有工具完成后才生效；慢工具会延迟下一轮判断 |
| **现有 `ToolProvider.execute` 接口** | 当前 `execute-tools.ts` 调用 `execute([tc])` 单个工具；未来批量调用可能暴露实现细节差异 | 保留单工具调用路径作为 fallback；并发时对独立工具批量调用，但需确保各 provider 实现无副作用 |

---

## 9. 结论

PI 的并行工具执行设计对 REM 具有直接借鉴价值，尤其在提升读密集型、多工具批次的执行效率方面。推荐采用 **preflight 顺序 + execution 可并发 + finalize 按源顺序输出** 的分阶段模型，并在类型层引入 `ToolExecutionMode`、`beforeToolCall`/`afterToolCall` hooks 以及 `terminate` hint。

该方案可以与 REM 现有 approval engine、security rule、workspace guard 平滑集成：审批和规则判断保留在 preflight 阶段，实际执行阶段可并发；最终通过源顺序写入 transcript，确保 LLM 上下文正确。实施时应分阶段迁移，先在默认关闭并行的情况下建立测试基线，再逐步开启默认并行，避免一次性破坏现有串行假设。

---

*报告结束*
