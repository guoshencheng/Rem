# Agent 循环外围编排对比分析

> 对比对象：OpenClaw、Hermes Agent、packages/core（当前项目）
> 分析维度：ReAct 循环实现、外围编排层、错误恢复、工具调度

---

## 1. ReAct 循环的本质

市面上的主流实现都是**"代码驱动的工作流 + 提示词行为约束"**的混合，而不是纯靠提示词让模型自己 ReAct，也不是一个完全硬编码的状态机。

### 为什么不使用纯提示词？

早期的 ReAct 论文确实用 `"Thought: ... Action: ... Observation: ..."` 的文本格式，但实际产品化后几乎没人再让模型自由输出这种格式：

- **不可靠**：模型可能输出格式错误的 Action，或在应该停止时继续 looping
- **延迟高**：每步都要等模型把 Thought 生成完才能解析 Action
- **成本高**：大量 token 花在格式化的 reasoning 上

现在的主流做法是利用**原生的 tool_use/function_call API**（OpenAI、Claude、Gemini 都支持）。模型输出结构化的 `tool_calls`，代码负责执行并把结果塞回 conversation，模型再决定下一步。ReAct 的"推理"体现在模型的内部思考或 `<thinking>` 标签里，但**循环控制完全由代码掌握**。

### 市面通用模板

```typescript
while (canContinue && !budgetExhausted) {
  const response = await llm.generate({ messages, tools });

  if (response.hasToolCalls) {
    const results = await executeTools(response.toolCalls);
    messages.push(assistantMessage(response));
    messages.push(...toolResultMessages(results));
  } else {
    return response.text; // 终止
  }
}
```

差异主要在**外层包装了多少容错和编排逻辑**：
- 简单的（如 LangChain `AgentExecutor`）：单层 loop，依赖模型自我终止
- 复杂的（如 OpenClaw、Hermes、Claude Code）：attempt-based 外层循环 + 错误分类 + provider 故障转移 + 上下文压缩 + 空闲超时断路器

---

## 2. 系统提示词策略

**关键发现：三个框架都没有在系统提示词中使用显式的 ReAct 格式。**

| 框架 | 系统提示词策略 |
|------|---------------|
| **OpenClaw** | 行为约束：`buildExecutionBiasSection` 告诉模型"现在就行动，不要只给计划"；可选的 `<think>` 标签约束 |
| **Hermes** | `TOOL_USE_ENFORCEMENT_GUIDANCE`："你必须使用工具去行动，不要只描述计划"；运行时通过 `<REASONING_SCRATCHPAD>` 处理后验推理 |
| **packages/core** | 极简：`You are ${name}.` |

真正的 ReAct 循环控制靠的是代码结构，而非提示词格式。

---

## 3. 外围编排对比图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OpenClaw — 最厚重的外层编排                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ 动态迭代上限     │───▶│ Attempt 分发    │───▶│ 空闲超时断路器   │         │
│  │ (24~160次)      │    │                 │    │                 │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                        │                    │
│  ┌─────────────────┐    ┌─────────────────┐           ▼                    │
│  │ 压缩后循环守卫   │◀───│ 内层 ReAct 循环  │◀─── 结果分类器               │
│  │                 │    │ stream→tool→exec │    (成功/超时/溢出/           │
│  └─────────────────┘    │ →feedback       │     不完整/Provider错误)      │
│                         └─────────────────┘                                │
│                                 ▲                                          │
│  ┌─────────────────┐           │           ┌─────────────────┐             │
│  │ 超时触发压缩     │───────────┘           │ 溢出触发压缩     │             │
│  │ (MAX=2)         │                       │ (MAX=3)         │             │
│  └─────────────────┘                       └─────────────────┘             │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Provider 错误    │───▶│ Auth轮换/故障转移│───▶│ 针对性重试指令   │         │
│  │ (HTTP-like状态码)│    │                 │    │ (规划/推理/空)  │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                                             │
│  ┌─────────────────┐                                                       │
│  │ before_agent_   │                                                       │
│  │ finalize Revision│                                                      │
│  │ (MAX_REVISIONS=3)│                                                      │
│  └─────────────────┘                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           Hermes — 中等厚度                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ 预算检查         │───▶│ max_iterations  │───▶│ Pre-API Steer   │         │
│  │ iteration_budget│    │ 硬上限           │    │ Drain (/steer)  │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                        │                    │
│  ┌─────────────────┐    ┌─────────────────┐           ▼                    │
│  │ Token 追踪+成本  │◀───│ 内层 ReAct 循环  │◀─── 内层 API 重试循环        │
│  │ 估算            │    │ LLM→解析→执行   │    │ jittered指数退避           │
│  └─────────────────┘    │ →feedback       │    │ + 最大重试次数             │
│                         └─────────────────┘    └─────────────────┘         │
│                                 ▲                    │                      │
│  ┌─────────────────┐           │           ┌────────┴─────────┐            │
│  │ 上下文压缩       │───────────┘           │ Provider Fallback │            │
│  │ (最多3次)       │                       │ 链               │            │
│  └─────────────────┘                       └───────────────────┘            │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Tool Guardrails │    │ 截断恢复         │    │ 智能并行化       │         │
│  │ (危险操作拦截)   │    │ (continuation)  │    │ (只读工具并发)   │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                       packages/core — 极简外层                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ 预算检查         │───▶│ canContinue()   │───▶│ Event Hook      │         │
│  │ checkTurn()     │    │ 状态判断         │    │ (turn:before/   │         │
│  └─────────────────┘    └─────────────────┘    │  after)         │         │
│                                                └─────────────────┘         │
│                                                        │                    │
│                                                        ▼                    │
│                                               ┌─────────────────┐          │
│                                               │ 内层循环:        │          │
│                                               │ generateText()  │          │
│                                               │ → toolCalls检测 │          │
│                                               │ → 继续/终止      │          │
│                                               └─────────────────┘          │
│                                                                             │
│  ⚠️ 缺失：API重试、Provider故障转移、上下文压缩、超时处理、                   │
│     不完整轮次检测、工具执行引擎                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. OpenClaw 外围编排详解

### 4.1 架构概述

OpenClaw 的 ReAct 循环是一种**基于 attempt 的架构**。主编排逻辑位于 `src/agents/embedded-agent-runner/run.ts`（约 3760 行），单个 attempt 由 `src/agents/embedded-agent-runner/run/attempt.ts`（约 5426 行）管理。

循环遵循模式：**attempt 执行 → 结果分类 → 重试/压缩/故障转移决策 → 下一个 attempt**。

### 4.2 外层循环关键特征

**动态迭代限制**：`MAX_RUN_LOOP_ITERATIONS` 不是硬编码常量，而是基于 profile 候选动态计算：

```typescript
const BASE_RUN_RETRY_ITERATIONS = 24;
const RUN_RETRY_ITERATIONS_PER_PROFILE = 8;
const MIN_RUN_RETRY_ITERATIONS = 32;
const MAX_RUN_RETRY_ITERATIONS = 160;
```

可用模型 profile 越多 = 重试预算越多，反映了故障转移链需要更多 attempt 的现实。

**Attempt 分发**：每次迭代调用 `runEmbeddedAttemptWithBackend()`（在 `run/backend.ts` 中），它是到 `runAgentHarnessAttempt()` 的薄桥接层。

**结果分类**：每次 attempt 后，运行器将结果分类为：成功、超时、溢出、不完整轮次（仅规划、仅推理、空响应）或 Provider 错误。

**压缩触发重试**：上下文溢出时触发压缩并重试，最多 `MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3` 次。

**超时处理**：超时重试受 `MAX_TIMEOUT_COMPACTION_ATTEMPTS = 2` 限制。

**空闲超时断路器**：成本失控预防机制（`MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT = 5`），统计连续空闲超时次数，超过阈值后强制输出。

### 4.3 单次 Attempt 内部流程

`runEmbeddedAttempt()` 编排以下内容：

1. **Setup**：解析 workspace、sandbox、plugin 元数据快照、provider runtime handle
2. **Skills & Context Engine**：解析 skill entries，确定活跃的 context engine
3. **Tool Construction**：构建工具计划，创建 coding tools，构建 tool search catalog
4. **Bootstrap & System Prompt**：解析 bootstrap 文件，构建 system prompt
5. **Session Lock & Session Manager**：获取 session 文件写锁，创建 SessionManager 和 AgentSession
6. **Context Engine Bootstrap**：运行 context engine bootstrap 和 maintenance
7. **Stream Setup**：解析 stream function，应用 provider stream wrappers
8. **Prompt Preparation**：清理 session history，验证 replay turns，运行 `before_agent_run` hooks
9. **Preemptive Compaction Check**：预测 token 压力，溢出时跳过 prompt submission
10. **Prompt Submission**：调用 `activeSession.prompt()`
11. **Post-Prompt Handling**：处理 yield-abort、mid-turn precheck、generic prompt error
12. **Async Task Wait**：等待异步工具任务完成
13. **Compaction Wait**：等待 inflight compaction
14. **Snapshot & Result Extraction**：提取 lastAssistant、usage totals、promptCache info
15. **Context Engine Finalize**：运行 context engine 的后 turn 生命周期
16. **Cleanup & Return**：释放资源，返回 `EmbeddedRunAttemptResult`

### 4.4 针对性重试指令

每种不完整轮次类型获得特定的重试指令：

```typescript
export const PLANNING_ONLY_RETRY_INSTRUCTION =
  "The previous assistant turn only described the plan. Do not restate the plan. Act now: take the first concrete tool action you can. If a real blocker prevents action, reply with the exact blocker in one sentence.";

export const REASONING_ONLY_RETRY_INSTRUCTION =
  "The previous assistant turn recorded reasoning but did not produce a user-visible answer. Continue from that partial turn and produce the visible answer now. Do not restate the reasoning or restart from scratch.";

export const EMPTY_RESPONSE_RETRY_INSTRUCTION =
  "The previous attempt did not produce a user-visible answer. Continue from the current state and produce the visible answer now. Do not restart from scratch.";
```

### 4.5 关键设计决策

1. **基于 attempt 而非基于轮次**：每个"attempt"是一次完整的模型调用，可能产生工具调用。循环在失败时重试整个 attempt。
2. **动态迭代限制**：循环上限随可用 profile 数量扩展。
3. **压缩作为重试策略**：上下文溢出不是终止错误，而是触发压缩 + 重试。
4. **空闲超时断路器**：纯函数对何时强制输出做出确定性决策，防止静默超时的无限成本累积。

### 4.6 优势与局限

**优势**：
- 对 Provider 故障具有弹性：循环自然支持在同一次运行内进行 Provider 故障转移
- 自动上下文管理：溢出透明地触发压缩
- 成本保护：空闲超时断路器防止失控消费
- 确定性重试逻辑：所有重试决策都通过具有明确阈值的纯函数做出

**局限**：
- `run.ts`（3760 行）和 `attempt.ts`（5426 行）是单体式的，难以单独推理和测试
- 没有显式 ReAct 状态机：循环使用临时条件判断而非形式化状态机
- 每次重试都是一次完整的模型调用，对于瞬时错误来说可能很昂贵
- 超时/溢出/压缩之间的复杂交互使得预测剩余 attempt 数量变得困难

---

## 5. Hermes Agent 外围编排详解

### 5.1 架构概述

Hermes 是典型的 **prompt-driven + while-loop**，代码结构相对清晰。

### 5.2 核心循环结构

**外层循环**（`agent/conversation_loop.py:461`）：

```python
while (api_call_count < agent.max_iterations and
       agent.iteration_budget.remaining > 0) or agent._budget_grace_call:
```

驱动轮次：调用 LLM，处理响应，执行工具，重复直到最终文本或限制命中。每次迭代是一次模型 API 调用。

**内层重试循环**（`conversation_loop.py:811`）：

```python
while retry_count < max_retries:
```

包装每次外层迭代中的实际 HTTP API 调用。处理瞬态失败、无效响应、速率限制、fallback provider 激活和压缩。

### 5.3 单次外层迭代流程

1. **预算和中断检查**（`conversation_loop.py:461-486`）：检查 `max_iterations` 和 `iteration_budget`，用户中断时立即 break
2. **Pre-API Steer Drain**（`conversation_loop.py:534-568`）：将待处理的 `/steer` 命令注入最近的 tool-role 消息
3. **构建 API Messages 和预压缩**（`conversation_loop.py`）：复制 messages，转换 reasoning 字段，proactive 压缩
4. **进入内层重试循环**（`conversation_loop.py:811`）：`retry_count` 重置，`TurnRetryState` 跟踪恢复标志
5. **Nous 速率限制守卫**（`conversation_loop.py:817-858`）：跨 session 速率限制时跳过 API 调用，尝试激活 fallback
6. **构建和执行 API 请求**（`conversation_loop.py:860-1025`）：选择 streaming vs non-streaming，调用 `run_llm_execution_middleware()`
7. **验证响应形状**（`conversation_loop.py:1046-1123`）：检查 `choices`/`output` 字段
8. **处理无效响应**（`conversation_loop.py:1125-1276`）：错误 hook、provider fallback、jittered 指数退避（5s 基础，120s 上限）
9. **检查 finish_reason**（`conversation_loop.py:1278-1313`）：`length` 时处理截断恢复
10. **更新 token 使用和压缩状态**（`conversation_loop.py:1566-1703`）：更新 `ContextCompressor`，持久化到 session DB
11. **退出重试循环**（`conversation_loop.py:1721`）：成功时 break
12. **处理中断的 API 调用**（`conversation_loop.py:3241-3244`）
13. **处理压缩重启**（`conversation_loop.py:3246-3254`）：退还迭代预算，decrement `api_call_count`
14. **处理 length continuation**（`conversation_loop.py:3256-3270`）：临时提升 `max_tokens`
15. **规范化 assistant message**（`conversation_loop.py:3281-3310`）
16. **Tool call 路径**（`conversation_loop.py:3475-3707`）：验证工具名、JSON 参数、guardrails、去重，调用 `_execute_tool_calls()`
17. **工具执行分发**（`run_agent.py:4991-5012`）：通过 `_should_parallelize_tool_batch()` 决定串行 vs 并发
18. **Post-tool 循环继续**（`conversation_loop.py:3732-3804`）：重置截断计数器，检查 `should_compress()`
19. **Final response 路径**（`conversation_loop.py:3806-4140`）：无 tool calls 时作为最终响应处理各种边界情况
20. **外层循环错误处理**（`conversation_loop.py:4142-4197`）：意外异常时填充 synthetic tool error
21. **Turn finalization**（`conversation_loop.py:4199-4209`）：组装 result dict

### 5.4 工具调度

- **并发执行**：独立只读工具通过 `ThreadPoolExecutor` 并发（`agent/tool_executor.py:243`）
- **串行执行**：有依赖关系的工具串行（`agent/tool_executor.py:5082`）
- **实际调用**：`model_tools.handle_function_call()`（`model_tools.py:876`）
- **结果追加**：以 `role: "tool"` 消息形式追加回 history

### 5.5 容错机制

- API 级别的指数退避重试
- Provider 故障转移链
- 上下文压缩（最多 3 次）
- 截断恢复、无效响应恢复、凭据刷新
- `ToolGuardrailDecision` 可在危险操作时 halt

### 5.6 关键设计决策

1. **双层 while 循环**：外层控制轮次，内层控制 API 重试
2. **Steer 命令**：运行时用户干预机制
3. **智能工具并行化**：自动判断工具依赖关系
4. **实时成本估算**：每次调用后更新 token 和成本

---

## 6. packages/core（当前项目）现状

### 6.1 当前实现

`packages/core/src/core-agent.ts:51-93`：

```typescript
while (this.state.canContinue() && !this.interrupted) {
  const result = await this._getLoop().executeTurn({...}, this.state);
  if (result.completed || this.interrupted) return {...};
}
```

`packages/core/src/loop.ts:29-96`：

- 调用 `generateText()` 并传入 tools
- 检测到 `toolCalls` 就继续循环，没有就终止
- 通过 EventBus 发射 `turn:before`、`phase:reason:before/after`、`turn:after` 事件

### 6.2 状态管理

- `AgentState`（`state.ts`）：`sessionId`、`conversation`、`currentTurn`、`budget`、`status`
- `IterationBudget`（`budget.ts`）：`turnCount`、`consecutiveErrors`、per-tool failure counts

### 6.3 已知缺口

- **没有 API 重试/退避机制**
- **没有 Provider 故障转移**
- **没有上下文压缩**
- **没有超时处理**
- **没有不完整轮次检测**
- **工具执行引擎未接入**：检测到 tool calls 后会继续循环，但不会执行工具，next turn 收不到 tool results

---

## 7. 外围能力总表

| 外围能力 | OpenClaw | Hermes | packages/core |
|---------|----------|--------|---------------|
| **迭代预算** | 动态（24~160） | 静态 + grace call | 静态（IterationBudget） |
| **API 重试** | 内层 attempt 有 | 内层 while 有 | ❌ |
| **Provider 故障转移** | Auth 轮换 + 模型 fallback | Fallback 链 | ❌ |
| **上下文压缩** | 可插拔 ContextEngine | ContextCompressor | ❌ |
| **超时处理** | 空闲超时断路器 | 内层重试超时 | ❌ |
| **不完整轮次检测** | 正则启发式 + 针对性指令 | 截断/空响应恢复 | ❌ |
| **Steer/运行时干预** | ❌ | `/steer` 命令 | Event hooks |
| **工具并发调度** | 由 executionMode 控制 | 智能并行化 | ❌（未接入） |
| **Token 成本追踪** | usage 统计 | 实时成本估算 | usage 字段 |
| **Guardrails** | ❌（直接运行） | ToolGuardrailDecision | ❌ |
| **系统提示词缓存** | 稳定/动态分割 + LRU | ❌ | ❌ |
| **Provider 专属适配** | 丰富的 hooks | 较少 | ❌ |
| **Session 持久化** | SQLite via Kysely | SQLite + FTS5 | ❌ |

---

## 8. 扩展建议

如果要扩展 `packages/core`，建议按优先级逐步实现：

### 优先级 1：工具执行引擎
当前最大的缺口。需要实现：
- Tool registry / discovery
- `executeTools()` 方法
- 串行/并行调度策略
- Tool result → message 的转换

### 优先级 2：API 错误恢复
- API 调用级别的重试（指数退避）
- 无效响应检测和重试
- 基本的错误分类

### 优先级 3：上下文管理
- Token 计数和预算追踪
- 上下文溢出检测
- 滑动窗口或摘要压缩

### 优先级 4：外围编排
- Provider 故障转移（可选，多 provider 场景）
- 不完整轮次检测
- 超时断路器

### 参考优先级
- **OpenClaw 最值得借鉴**：错误分类决策树、attempt-based 外层编排、针对性重试指令、空闲超时断路器
- **Hermes 最值得借鉴**：智能工具并行化、steer 机制、实时成本估算

---

*文档生成时间：2026-06-11*
*参考源码：OpenClaw `src/agents/embedded-agent-runner/run.ts`、`run/attempt.ts`；Hermes `agent/conversation_loop.py`、`run_agent.py`；当前项目 `packages/core/src/core-agent.ts`、`loop.ts`*
