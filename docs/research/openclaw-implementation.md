# OpenClaw 框架实现深度解析

深入对比 OpenClaw 与 Hermes 实现的研究文档。
涵盖 7 个核心模块：ReAct 循环、系统提示词、错误处理、上下文压缩、工具调度、流式传输和插件系统。

---

## 1. ReAct 循环实现

### 1.1 概述

OpenClaw 的 ReAct 循环是一种基于 attempt 的架构，围绕嵌入式 agent 运行器构建。主编排逻辑位于 `src/agents/embedded-agent-runner/run.ts`（约 3760 行），单个 attempt 由 `src/agents/embedded-agent-runner/run/attempt.ts`（约 5426 行）管理。循环遵循以下模式：attempt 执行 -> 结果分类 -> 重试/压缩/故障转移决策 -> 下一个 attempt。

### 1.2 关键实现细节

**文件：`src/agents/embedded-agent-runner/run.ts`**

外层循环是一个 `while(true)` 重试循环，具有以下关键特征：

- **动态迭代限制**：`MAX_RUN_LOOP_ITERATIONS` 不是硬编码常量，而是基于 profile 候选动态计算：
  ```typescript
  const BASE_RUN_RETRY_ITERATIONS = 24;
  const RUN_RETRY_ITERATIONS_PER_PROFILE = 8;
  const MIN_RUN_RETRY_ITERATIONS = 32;
  const MAX_RUN_RETRY_ITERATIONS = 160;
  ```
  这意味着可用模型 profile 越多 = 重试预算越多，反映了故障转移链需要更多 attempt 的现实。

- **Attempt 分发**：每次迭代调用 `runEmbeddedAttemptWithBackend()`（在 `run/backend.ts` 中），它是到 `runAgentHarnessAttempt()` 的薄桥接层。

- **结果分类**：每次 attempt 后，运行器将结果分类为：成功、超时、溢出、不完整轮次（仅规划、仅推理、空响应）或提供程序错误。

- **压缩触发重试**：当发生上下文溢出时，运行器触发压缩并重试，最多 `MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3` 次。

- **超时处理**：超时重试受 `MAX_TIMEOUT_COMPACTION_ATTEMPTS = 2` 限制。

- **空闲超时断路器**：一种成本失控预防机制（`MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT = 5`），统计连续空闲超时次数，超过阈值后强制输出。

**文件：`src/agents/embedded-agent-runner/run/attempt.ts`**

单个 attempt 编排以下内容：
1. 提示词设置和系统提示词构建
2. 工具构建（包括工具搜索目录）
3. 会话创建/检索
4. 通过后端执行流式传输
5. 结果处理（工具调用、文本输出、不完整轮次检测）

### 1.3 关键设计决策

1. **基于 attempt 而非基于轮次**：每个"attempt"是一次完整的模型调用，可能产生工具调用。循环在失败时重试整个 attempt，而非仅重试单个工具调用。这简化了状态管理，但意味着重试时会有更多 API 调用。

2. **动态迭代限制**：循环上限不是固定的，而是随可用 profile 数量扩展。这承认了多提供程序设置需要更多重试余量。

3. **压缩作为重试策略**：上下文溢出不是终止错误，而是触发压缩 + 重试。这自动保持长会话的存活。

4. **空闲超时断路器**：纯函数 `stepIdleTimeoutBreaker()`（在 `idle-timeout-breaker.ts` 中）对何时强制输出做出确定性决策，防止静默超时的无限成本累积。

### 1.4 优势

- **对提供程序故障具有弹性**：循环自然支持在同一次运行内进行提供程序故障转移。
- **自动上下文管理**：溢出透明地触发压缩。
- **成本保护**：空闲超时断路器防止失控消费。
- **确定性重试逻辑**：所有重试决策都通过具有明确阈值的纯函数做出。

### 1.5 劣势 / 局限性

- **大文件**：`run.ts`（3760 行）和 `attempt.ts`（5426 行）是单体式的，使得循环难以单独推理和测试。
- **没有显式 ReAct 状态机**：循环使用临时条件判断而非形式化状态机，使得验证正确性更加困难。
- **重试放大**：每次重试都是一次完整的模型调用，对于瞬时错误来说可能很昂贵。
- **超时/溢出/压缩之间的复杂交互**：重试预算在故障模式之间共享，使得预测剩余 attempt 数量变得困难。

---

## 2. 系统提示词构建

### 2.1 概述

OpenClaw 中的系统提示词构建是一个多阶段流水线，将稳定上下文（身份、工具、记忆）与动态运行时参数结合。渲染器位于 `src/agents/system-prompt.ts`（约 1381 行），参数解析在 `src/agents/system-prompt-params.ts` 中。

### 2.2 关键实现细节

**文件：`src/agents/system-prompt.ts`**

- **提示词模式**：三种模式 —— "full"、"minimal"、"none" —— 控制包含多少上下文。

- **稳定前缀 LRU 缓存**：用于昂贵稳定前缀计算的有界缓存：
  ```typescript
  const SYSTEM_PROMPT_STABLE_PREFIX_CACHE_LIMIT = 64;
  const stablePromptPrefixCache = new Map<string, StablePromptPrefixCacheEntry>();
  ```
  这避免了在每次轮次重新渲染未更改的上下文文件。

- **上下文文件排序**：上下文文件的确定性排序：
  ```typescript
  const CONTEXT_FILE_ORDER = new Map<string, number>([
    ["agents.md", 10], ["soul.md", 20], ["identity.md", 30],
    ["user.md", 40], ["tools.md", 50], ["bootstrap.md", 60], ["memory.md", 70],
  ]);
  ```

- **缓存边界**：`SYSTEM_PROMPT_CACHE_BOUNDARY` 常量标记稳定前缀结束和动态内容开始的位置。这对于 Anthropic 等提供程序上的提示词缓存优化至关重要。

- **提供程序贡献**：`provider-runtime.ts` 中的 `resolveProviderSystemPromptContribution()` 允许插件注入提供程序专属的系统提示词内容。

**文件：`src/agents/system-prompt-params.ts`**

收集运行时参数：仓库根目录、时区、时间格式和其他环境专属值。

### 2.3 关键设计决策

1. **稳定/动态分割**：系统提示词被显式分割为稳定（缓存）和动态（每轮次）部分。这使得提供程序级别的提示词缓存成为可能，稳定前缀可以在轮次间缓存。

2. **稳定前缀 LRU 缓存**：不是在每次轮次重新计算稳定部分，而是以 64 条 LRU 缓存。这是对上下文文件不更改的常见情况的务实优化。

3. **确定性文件排序**：上下文文件按优先级而非文件系统顺序排序，确保跨环境的一致提示词构建。

4. **提供程序可扩展性**：`resolveProviderSystemPromptContribution()` 钩子允许提供程序注入自己的指导，而无需修改核心。

### 2.4 优势

- **提示词缓存友好**：稳定/动态分割直接支持 Anthropic 风格的提示词缓存，降低 token 成本。
- **确定性**：固定排序和显式缓存边界意味着提示词是可复现的。
- **性能**：LRU 缓存避免每次轮次的冗余工作。
- **可扩展**：提供程序插件可以干净地贡献系统提示词内容。

### 2.5 劣势 / 局限性

- **缓存失效是手动的**：当磁盘上的上下文文件更改时，LRU 缓存不会自动失效。
- **64 条缓存可能偏小**：对于具有许多上下文文件或频繁切换的 agent，可能发生缓存抖动。
- **提供程序贡献排序是隐式的**：提供程序注入内容相对于核心内容的顺序无法显式配置。
- **没有版本控制**：系统提示词没有显式版本哈希，使得检测提示词何时发生实质性变化变得困难。

---

## 3. 错误处理与重试策略

### 3.1 概述

OpenClaw 拥有复杂的多层错误处理系统：(1) 故障转移错误分类，(2) 嵌套 cause 遍历的提供程序故障转移，(3) 超时/溢出重试预算，以及 (4) 带针对性重试指令的不完整轮次检测。

### 3.2 关键实现细节

**文件：`src/agents/failover-error.ts`**

- **`FailoverError` 类**：结构化错误，包含状态、原因、提供程序信息和嵌套 cause 字段。

- **状态码映射**：`resolveFailoverStatus()` 将错误原因映射为类似 HTTP 的状态码以保持一致处理：
  - 4xx = 客户端/配置错误（不要以相同配置重试）
  - 5xx = 服务器/提供程序错误（重试/故障转移）
  - 429 = 速率限制（退避 + 重试）

- **嵌套 cause 遍历**：`MAX_FAILOVER_CAUSE_DEPTH = 25` 限制错误分类器遍历嵌套 `cause` 链的深度。这防止了循环错误引用导致的无限循环。

- **本地 vs 提供程序错误检测**：`isNonProviderRuntimeCoordinationError()` 区分本地运行时错误（不应触发提供程序故障转移）和实际提供程序故障。

**文件：`src/agents/embedded-agent-runner/run/incomplete-turn.ts`**

使用基于正则的分类检测和处理不完整的助手轮次：

- **仅规划检测**：使用多个正则模式检测助手仅描述计划而未采取行动的情况：
  ```typescript
  const PLANNING_ONLY_PROMISE_RE = /\b(?:i(?:'ll| will)|let me|i(?:'m| am)\s+going to|first[, ]+i(?:'ll| will)|next[, ]+i(?:'ll| will)|i can do that)\b/i;
  const PLANNING_ONLY_COMPLETION_RE = /\b(?:done|finished|implemented|updated|fixed|changed|ran|verified|found|here(?:'s| is) what|blocked by|the blocker is)\b/i;
  const PLANNING_ONLY_HEADING_RE = /^(?:plan|steps?|next steps?)\s*:/i;
  const PLANNING_ONLY_BULLET_RE = /^(?:[-*•]\s+|\d+[.)]\s+)/u;
  ```

- **重试指令**：每种不完整轮次类型都获得注入到下一个提示词中的特定重试指令：
  ```typescript
  export const PLANNING_ONLY_RETRY_INSTRUCTION = "The previous assistant turn only described the plan. Do not restate the plan. Act now: take the first concrete tool action you can. If a real blocker prevents action, reply with the exact blocker in one sentence.";
  export const REASONING_ONLY_RETRY_INSTRUCTION = "The previous assistant turn recorded reasoning but did not produce a user-visible answer. Continue from that partial turn and produce the visible answer now. Do not restate the reasoning or restart from scratch.";
  export const EMPTY_RESPONSE_RETRY_INSTRUCTION = "The previous attempt did not produce a user-visible answer. Continue from the current state and produce the visible answer now. Do not restart from scratch.";
  ```

**文件：`src/agents/embedded-agent-runner/run/idle-timeout-breaker.ts`**

- 纯函数 `stepIdleTimeoutBreaker()`，带有空闲超时计数的决策表。
- `MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT = 5` 在 5 次连续空闲超时后强制可见输出。
- 对"首次空闲超时" vs"后续空闲超时" vs"已有输出"的不同行为。

### 3.3 关键设计决策

1. **用于错误的类似 HTTP 状态码**：将提供程序错误映射到统一的状态码空间简化了重试/故障转移逻辑。

2. **嵌套 cause 深度限制**：25 级限制是对循环引用的务实防御，同时仍处理深度嵌套的异步错误链。

3. **基于正则的不完整轮次检测**：OpenClaw 不使用模型的结构化输出或工具调用存在性，而是对原始文本使用正则启发式。这在所有提供程序上都快速有效，但本质上是近似的。

4. **针对性重试指令**：不是通用的"重试"提示词，每种故障模式都获得引导模型朝向期望行为的特定指令。

5. **空闲超时作为状态机**：断路器使用带有显式状态转换的纯函数，使其可测试且确定性。

### 3.4 优势

- **全面的错误分类**：区分提供程序错误与本地错误，速率限制与认证失败等。
- **优雅降级**：提供程序故障转移在同一次运行中自动发生。
- **智能重试指令**：针对性提示词帮助模型从特定故障模式中恢复。
- **成本保护**：空闲超时断路器防止静默成本累积。

### 3.5 劣势 / 局限性

- **正则启发式很脆弱**：仅规划检测依赖可能因非英语输出或不寻常措辞而失效的英语正则模式。
- **没有结构化错误恢复**：重试系统在 attempt 级别而非工具调用级别运作。单个失败的工具调用仍然需要完整重新提示。
- **硬编码阈值**：重试预算（24-160 次迭代，2 次超时 attempt，3 次溢出 attempt）无法按 agent 或按提供程序配置。
- **不完整轮次检测仅限文本**：它不考虑工具调用结果或会话状态，仅考虑助手的文本输出。

---

## 4. 上下文压缩 / 压缩

### 4.1 概述

OpenClaw 的上下文压缩是一个多层系统，包含：(1) 可插拔的 ContextEngine 接口，(2) 插件拥有压缩的安全超时，(3) 压缩前的检查点快照，(4) 转录轮换，以及 (5) 压缩后循环守卫。

### 4.2 关键实现细节

**文件：`src/context-engine/types.ts`**

`ContextEngine` 接口定义了可插拔契约：
```typescript
export interface ContextEngine {
  readonly info: ContextEngineInfo;
  bootstrap?(params: { sessionId, sessionKey?, sessionFile }): Promise<BootstrapResult>;
  maintain?(params: { sessionId, sessionKey?, sessionFile, runtimeContext? }): Promise<ContextEngineMaintenanceResult>;
  ingest(params: { sessionId, sessionKey?, message, isHeartbeat? }): Promise<IngestResult>;
  ingestBatch?(params: { sessionId, sessionKey?, messages, isHeartbeat? }): Promise<IngestBatchResult>;
  afterTurn?(params: { sessionId, sessionKey?, sessionFile, messages, prePromptMessageCount, ... }): Promise<void>;
  assemble(params: { sessionId, sessionKey?, messages, tokenBudget?, availableTools?, citationsMode?, model?, prompt? }): Promise<AssembleResult>;
  compact(params: { sessionId, sessionKey?, sessionFile, tokenBudget?, force?, currentTokenCount?, compactionTarget?, customInstructions?, runtimeContext?, abortSignal? }): Promise<CompactResult>;
  prepareSubagentSpawn?(params: { parentSessionKey, childSessionKey, contextMode?, ... }): Promise<SubagentSpawnPreparation | undefined>;
  onSubagentEnded?(params: { childSessionKey, reason }): Promise<void>;
  dispose?(): Promise<void>;
}
```

关键标志：
- `ownsCompaction?: boolean` —— 引擎管理自己的压缩生命周期
- `turnMaintenanceMode?: "foreground" | "background"` —— 控制轮次触发的维护

**文件：`src/agents/embedded-agent-runner/compact.ts`**

- 入口点：`compactEmbeddedAgentSessionDirect()`，支持模型回退。
- 使用 `compactWithSafetyTimeout()` 实现有界执行。
- 在压缩前捕获检查点快照以支持回滚。
- 支持压缩后的转录轮换（会话 ID/文件可能更改）。

**文件：`src/agents/embedded-agent-runner/compaction-safety-timeout.ts`**

- `EMBEDDED_COMPACTION_TIMEOUT_MS = 900_000`（15 分钟）限定插件拥有的压缩。
- `compactContextEngineWithSafetyTimeout()` 使用超时包装引擎的 `compact()` 调用。
- abort 信号会传递给引擎，允许协作式取消。

**文件：`src/agents/embedded-agent-runner/post-compaction-loop-guard.ts`**

- `DEFAULT_WINDOW_SIZE = 3` —— 观察最近 3 个轮次以检测循环。
- 从工具名称 + 参数哈希 + 结果哈希计算指纹。
- 当相同的工具调用模式在压缩后重复时，抛出 `PostCompactionLoopPersistedError`。
- 这捕获了压缩实际上没有改变行为的情况（例如，模型不断使用相同参数调用相同工具）。

**文件：`src/agents/embedded-agent-runner/run.ts`（压缩集成）**

- 上下文溢出触发压缩 + 重试，最多 `MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3` 次。
- 超时触发压缩 + 重试，最多 `MAX_TIMEOUT_COMPACTION_ATTEMPTS = 2` 次。
- 压缩后，压缩后循环守卫检查持久循环。

### 4.3 关键设计决策

1. **可插拔 ContextEngine**：不是硬编码单一压缩策略，OpenClaw 定义了插件可以实现的标准接口。这允许不同策略（摘要、RAG、滑动窗口等）共存。

2. **插件压缩的安全超时**：插件拥有的压缩在同一进程中运行，带有 15 分钟安全超时。这防止了有缺陷或缓慢的压缩实现。

3. **检查点快照**：压缩前，捕获快照以便在压缩损坏状态时回滚会话。

4. **转录轮换**：压缩后，会话可能轮换到新转录文件。这使活跃转录保持小而保留历史。

5. **压缩后循环守卫**：压缩有时可能无法打破循环（例如，如果模型行为是确定性的）。循环守卫检测到这一点并抛出错误，而非无限循环。

6. **上下文投影模式**：`ContextEngineProjection` 支持"per_turn"（传统）和"thread_bootstrap"（持久后端线程）模式。

### 4.4 优势

- **可插拔架构**：可以在不更改核心的情况下切换不同的上下文管理策略。
- **安全保证**：超时、检查点和循环守卫提供多层保护。
- **对模型透明**：压缩发生在轮次之间，因此模型看到的是干净的上下文窗口。
- **子 agent 支持**：`prepareSubagentSpawn` 和 `onSubagentEnded` 支持子 agent 的上下文分叉/隔离。

### 4.5 劣势 / 局限性

- **插件压缩是同步阻塞的**：即使带有安全超时，整个运行也会在压缩执行期间被阻塞。
- **15 分钟超时可能太长**：对于交互式使用，15 分钟太长了。没有中间的"放弃并返回部分结果"路径。
- **循环守卫仅捕获精确重复**：基于哈希的检测不会捕获语义循环（相同意图，不同参数）。
- **没有压缩质量指标**：没有反馈循环来判断压缩是否真正改善上下文质量，还是仅仅减少 token 数量。
- **ContextEngine 接口很大**：10+ 方法使其成为一个需要实现的重量级接口。带有许多可选字段的 `runtimeContext` 参数增加了复杂性。

---

## 5. 工具调度与执行

### 5.1 概述

OpenClaw 中的工具调度涉及：(1) 来自多个来源的工具模式构建，(2) 用于大型工具清单的工具搜索目录，(3) 用于动态工具评估的代码模式 VM 隔离，以及 (4) 提供程序专属的工具模式转换。

### 5.2 关键实现细节

**文件：`src/agents/embedded-agent-runner/run/attempt.ts`**

每个 attempt 发生工具构建：
1. 从插件、内置和上下文收集可用工具
2. 应用提供程序专属的模式转换
3. 如果工具数量超过阈值，激活工具搜索目录
4. 为模型构建工具模式

**文件：`src/agents/tool-search.ts`**

- **目录压缩**：当工具清单很大时，工具隐藏在控制工具后面（`tool_search`、`tool_search_code`、`tool_describe`、`tool_call`）。
- **代码模式**：生成带有 VM 上下文的隔离 Node 子进程以评估工具搜索代码：
  ```typescript
  const TOOL_SEARCH_CONTROL_TOOL_NAMES = [
    "tool_search_code",
    "tool_search",
    "tool_describe",
    "tool_call",
  ];
  ```
- **会话作用域缓存**：工具目录按会话缓存，基于指纹复用。如果工具清单未更改，则复用缓存目录。
- **基于指纹的失效**：缓存键是工具清单的哈希，因此更改会自动失效。

**文件：`src/plugins/provider-runtime.ts`**

- `resolveProviderToolSchemas()` 应用提供程序专属的工具模式转换。
- 某些提供程序需要扁平字符串枚举而非 `Type.Union([Type.Literal(...)])`。
- 工具模式兼容性助手跨提供程序家族规范化模式。

**文件：`src/agents/embedded-agent-runner/run.ts`**

- 每个流完成后处理工具结果。
- 通过后压缩循环守卫检测工具调用循环。
- 空闲超时断路器在决定是否产生输出时考虑工具调用。

### 5.3 关键设计决策

1. **工具搜索目录模式**：不是将所有工具发送给模型（这会浪费上下文窗口），大型清单通过搜索/描述/调用控制工具进行压缩。模型必须显式搜索工具。

2. **代码模式的 VM 隔离**：工具搜索代码在单独的 Node 进程中运行，带有 VM 上下文隔离。这防止工具搜索代码访问宿主进程。

3. **提供程序专属模式规范化**：不是强制所有插件发出提供程序兼容的模式，核心在分发时基于活跃提供程序规范化模式。

4. **会话作用域缓存**：工具目录计算成本很高（哈希所有工具模式），因此按会话缓存。

### 5.4 优势

- **扩展到大型工具清单**：工具搜索模式保持上下文窗口可控，不受工具数量影响。
- **安全隔离**：VM 子进程防止工具搜索代码逃逸。
- **提供程序无关**：工具模式在边界处规范化，因此插件不需要提供程序专属逻辑。
- **高效缓存**：基于指纹的缓存避免重新计算目录。

### 5.5 劣势 / 局限性

- **工具搜索增加延迟**：每次工具搜索都是额外的模型调用（搜索 -> 描述 -> 调用），增加往返次数。
- **VM 子进程开销**：为代码模式生成 Node 进程在内存和启动时间方面成本高昂。
- **目录阈值是固定的**：激活工具搜索的阈值不会基于上下文窗口大小或工具复杂度动态调整。
- **没有工具结果流式传输**：工具结果被收集并作为单个批次发送，这可能延迟长运行工具的模型响应。
- **工具模式规范化是有损的**：规范化期间可能丢失某些提供程序专属的模式功能。

---

## 6. 流式传输支持

### 6.1 概述

OpenClaw 的流式传输支持涉及：(1) 具有多种提供程序策略的流函数解析，(2) 认证注入，(3) 用于取消的信号合并，(4) 提示词缓存键注入，以及 (5) 为提供程序流剥离缓存边界。

### 6.2 关键实现细节

**文件：`src/agents/embedded-agent-runner/stream-resolution.ts`**

- `resolveEmbeddedAgentStreamFn()` 选择适当的流实现：
  - 提供程序拥有的流（来自插件钩子）
  - 边界感知流（针对特定提供程序家族）
  - 自定义流（用于测试/调试）

- **认证解析**：将认证凭证注入流请求。

- **信号合并**：将运行级 abort 信号与任何提供程序专属信号合并：
  ```typescript
  // 合并 abort 信号，使任一信号都可以取消流
  ```

- **提示词缓存键注入**：为支持提示词缓存的提供程序（例如 Anthropic）注入缓存键。

- **缓存边界剥离**：在发送到提供程序流之前剥离 `SYSTEM_PROMPT_CACHE_BOUNDARY` 标记，因为提供程序不理解此内部标记。

**文件：`src/agents/embedded-agent-runner/run/attempt.ts`**

- 流执行是每个 attempt 的核心。
- 流块累积为最终结果。
- 对于支持增量解析的提供程序，逐步解析工具调用块。

**文件：`src/plugins/provider-runtime.ts`**

- `resolveProviderStream()` 组合提供程序专属的流包装器。
- 流包装器组合处理：认证、重放策略、传输装饰、思考模式和工具模式兼容性。
- 当提供程序钩子的包装器组合嵌套链增长时，`src/plugins/CLAUDE.md` 中的边界规则将其视为提取共享助手的回归信号。

### 6.3 关键设计决策

1. **运行时的流函数解析**：不是硬编码流实现，而是基于活跃提供程序及其钩子动态解析。这支持插件定义的流行为。

2. **信号合并**：多个取消来源（用户中止、超时、提供程序信号）合并为单个信号，简化下游代码。

3. **缓存边界剥离**：内部缓存标记在提供程序边界处剥离，保持面向提供程序的代码不受内部约定污染。

4. **包装器组合模式**：流行为通过包装器组合（认证 -> 重放 -> 传输 -> 思考），每层添加一层。这是可扩展的，但可能导致深度嵌套。

### 6.4 优势

- **提供程序可扩展**：插件可以定义自定义流行为。
- **干净的取消**：信号合并提供统一的取消模型。
- **提示词缓存集成**：流解析透明处理缓存键注入。
- **分层组合**：每个流关注点隔离在自己的包装器中。

### 6.5 劣势 / 局限性

- **包装器组合可能变得很深**：边界规则明确将深度包装器链视为回归信号，表明这是已知问题。
- **没有统一的流协议**：每个提供程序可能有自己的块格式，需要提供程序专属解析逻辑。
- **流解析是同步的**：解析在流开始之前发生；没有流中动态重新解析。
- **缓存边界剥离是字符串操作**：它是简单的字符串替换，理论上可能匹配非预期内容。

---

## 7. 插件 / 扩展系统

### 7.1 概述

OpenClaw 的插件系统是一个全面的架构，包含：(1) 插件发现和清单验证，(2) 运行时钩子注册，(3) 带有故障关闭策略的全局钩子运行器，(4) 提供程序运行时组合，以及 (5) 将控制平面与运行时平面分离的 SDK 边界。

### 7.2 关键实现细节

**文件：`src/plugins/hook-runner-global.ts`**

- 加载插件时初始化的全局单例钩子运行器：
  ```typescript
  export function initializeGlobalHookRunner(registry: GlobalHookRunnerRegistry): void {
    state.registry = registry;
    state.hookRunner = createHookRunner(registry, {
      logger: { debug, warn, error },
      catchErrors: true,
      failurePolicyByHook: {
        before_agent_run: "fail-closed",
        before_install: "fail-closed",
        before_tool_call: "fail-closed",
      },
    });
  }
  ```

- **故障关闭策略**：关键钩子（`before_agent_run`、`before_install`、`before_tool_call`）故障关闭 —— 如果钩子抛出，操作中止。

- **错误捕获**：非关键钩子捕获错误并记录，允许运行继续。

- **`runGlobalGatewayStopSafely()`**：`gateway_stop` 钩子的特殊安全包装器，捕获错误而非传播（因为网关停止应始终完成）。

**文件：`src/plugins/provider-runtime.ts`**

- 提供程序运行时组合，带有广泛的钩子点：
  - `resolveProviderSystemPromptContribution()` —— 注入系统提示词内容
  - `transformProviderSystemPrompt()` —— 转换系统提示词文本
  - `resolveProviderAuth()` —— 解析认证
  - `resolveProviderStream()` —— 解析流函数
  - `resolveProviderToolSchemas()` —— 规范化工具模式
  - `resolveProviderReplayPolicy()` —— 配置重放行为
  - `resolveProviderThinking()` —— 配置思考模式
  - `resolveProviderTransport()` —— 配置传输层

- **家族级助手**：优先于提供程序专属代码的共享助手，用于重放策略、工具兼容性、负载规范化和流包装器组合。

**文件：`src/plugin-sdk/agent-core.ts`**

- Agent 核心契约（27 行）：
  ```typescript
  export class Agent extends CoreAgent {
    // OpenClaw 运行时依赖
  }
  ```

**文件：`src/plugins/CLAUDE.md`（边界规则）**

关键边界规则：
- 控制平面和运行时平面分离。
- 清单优先：发现/配置在运行时执行之前从元数据工作。
- 没有私有后门：捆绑插件使用与外部插件相同的公共 API。
- 惰性：发现和激活是惰性的；重量级运行时模块不会急于导入。
- 不将"插件拥有"规范化到"核心拥有"：优先通用助手和钩子。
- 可变全局运行时注册表是"兼容性脚手架，而非期望的真相来源"。

**文件：`src/plugin-sdk/CLAUDE.md`（SDK 边界）**

关键 SDK 规则：
- 宿主加载插件；插件不应触及宿主内部。
- 小型版本化宿主/内核接缝加上狭窄的 SDK 入口点。
- 不暴露内部实现的便利。
- 保持 SDK 门面无环。
- 优先使用 `api.runtime` 或专注的 SDK 门面而非触及宿主内部。
- 家族级接缝优先于提供程序专属接缝。

### 7.3 关键设计决策

1. **全局钩子运行器单例**：单个全局钩子运行器在启动时初始化，并在整个代码库中访问。这是务实的，但边界规则明确说明它是"兼容性脚手架，而非期望的真相来源"。

2. **关键钩子的故障关闭**：安全敏感钩子故障关闭。这防止有缺陷的插件静默损坏 agent 运行。

3. **清单优先发现**：插件在运行时代码执行之前从其清单中被发现和验证。这支持早期错误检测和惰性加载。

4. **控制平面 / 运行时平面分离**：发现、配置验证和设置是控制平面关注点；实际执行是运行时。这种分离使 `openclaw doctor` 等工具可以在不加载重量级运行时模块的情况下工作。

5. **提供程序家族助手**：不是每个提供程序插件实现自己的重放策略、工具兼容性等，共享助手集中通用行为。这减少了重复，但需要仔细设计助手 API。

6. **核心不感知捆绑插件内部**：核心仅使用公共 SDK API 和通用契约，而非深度导入捆绑插件源码。

### 7.4 优势

- **定义良好的边界**：CLAUDE.md 边界规则创建了清晰的所有权并防止架构漂移。
- **安全优先**：故障关闭策略防止插件错误损坏运行。
- **惰性加载**：重量级运行时模块直到需要时才加载，改善启动时间。
- **可扩展**：可以在不修改核心的情况下添加新提供程序、工具和钩子。
- **插件平等**：捆绑和外部插件使用相同的 API，确保 SDK 实际上足够。

### 7.5 劣势 / 局限性

- **全局可变状态**：钩子运行器全局单例被承认为"兼容性脚手架"。对于新代码，优先使用请求作用域句柄。
- **钩子组合复杂性**：提供程序钩子可以以复杂方式组合包装器，边界规则将深度嵌套视为回归信号。
- **SDK 表面很大**：`src/plugin-sdk/CLAUDE.md` 明确说明"SDK 表面太大"并警告不要添加更多兼容 barrels。
- **插件加载是进程作用域的**：插件元数据在进程生命周期内稳定；更改需要重启。这是设计如此，但限制了热重载场景。
- **除了 VM 隔离外没有插件沙箱**：插件代码在同一 Node 进程中运行（除了代码模式 VM）。恶意插件可能潜在访问宿主。

---

## 总结对比表

| 模块 | OpenClaw 方法 | 关键文件 |
|------|--------------|---------|
| ReAct 循环 | 基于 attempt，动态迭代限制，压缩触发重试，空闲超时断路器 | `run.ts`、`attempt.ts`、`idle-timeout-breaker.ts` |
| 系统提示词 | 稳定/动态分割，LRU 缓存，提供程序贡献，缓存边界标记 | `system-prompt.ts`、`system-prompt-params.ts` |
| 错误处理 | 类似 HTTP 状态码，嵌套 cause 遍历（最大深度 25），基于正则的不完整轮次检测 | `failover-error.ts`、`incomplete-turn.ts` |
| 上下文压缩 | 可插拔 ContextEngine 接口，15 分钟安全超时，检查点快照，循环守卫 | `compact.ts`、`compaction-safety-timeout.ts`、`post-compaction-loop-guard.ts` |
| 工具调度 | 用于大型清单的工具搜索目录，VM 隔离代码模式，提供程序模式规范化 | `tool-search.ts`、`attempt.ts` |
| 流式传输 | 运行时流解析，信号合并，提示词缓存注入，包装器组合 | `stream-resolution.ts`、`provider-runtime.ts` |
| 插件系统 | 带故障关闭策略的全局钩子运行器，清单优先发现，控制/运行分离 | `hook-runner-global.ts`、`provider-runtime.ts`、`plugin-sdk/` |

## 关键架构主题

1. **安全第一**：每个模块都有多种安全机制（超时、守卫、检查点、故障关闭策略）。
2. **可插拔性**：核心定义接口；插件实现它们。ContextEngine、提供程序钩子和流解析都遵循此模式。
3. **确定性**：LRU 缓存、确定性排序、纯函数和显式状态机使行为可预测。
4. **边界纪律**：CLAUDE.md 文件在核心、插件和 SDK 之间强制执行严格的所有权边界。
5. **性能务实主义**：缓存、惰性加载和基于指纹的复用优化热路径而不会过度工程化。
