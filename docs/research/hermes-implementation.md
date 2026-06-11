# Hermes Agent Framework — 深度实现研究

**研究日期：** 2026-06-10  
**来源：** `/Users/guoshencheng/Documents/work/rem/refer/hermes-agent/`  
**范围：** ReAct 循环、系统提示词、错误处理、上下文压缩、工具调度、流式传输、插件系统

---

## 1. ReAct 循环实现

### 1.1 主入口点

对话循环位于 `agent/conversation_loop.py`（约 2,400 行）。函数 `run_conversation()`（第 371 行）是从原始 `run_agent.py` 中提取的核心入口点。

**文件：** `agent/conversation_loop.py:371-4199`

### 1.2 循环结构：外层迭代循环 + 内层重试循环

该循环具有清晰的两层嵌套结构：

**外层迭代循环**（第 461 行）：控制每次对话轮次的 API 调用次数。
```python
while (api_call_count < agent.max_iterations and agent.iteration_budget.remaining > 0) or agent._budget_grace_call:
```

- `max_iterations`：默认 90，可配置。
- `iteration_budget`：线程安全计数器（`agent/iteration_budget.py:17-63`），支持 consume/refund 语义。
- Grace call：预算耗尽时额外的一次调用，给模型最后一次机会。

**内层重试循环**（第 811 行）：处理每次调用的瞬时 API 故障。
```python
while retry_count < max_retries:
```
- `max_retries`：默认 3，来自 `agent._api_max_retries`。
- 使用 `TurnRetryState`（`agent/turn_retry_state.py:32-68`）跟踪一次性恢复标志。

### 1.3 工具调用检测与执行

成功获取 API 响应后，循环对响应进行标准化处理（第 3281-3309 行）并检查工具调用（第 3475 行）：

```python
if assistant_message.tool_calls:
    # 验证工具名称（第 3485-3494 行）
    # 验证 JSON 参数（第 3537-3624 行）
    # 构建 assistant 消息（第 3637 行）
    # 执行工具调用（第 3707 行）
    agent._execute_tool_calls(assistant_message, messages, effective_task_id, api_call_count)
```

工具执行支持顺序和并发两种模式（详见第 5 节）。

### 1.4 循环终止决策

循环通过以下多条路径终止：

1. **最终文本响应**（第 3806-4140 行）：无工具调用，assistant 返回文本内容。
2. **预算耗尽**（第 482-486 行）：迭代预算已消耗完毕。
3. **用户中断**（第 466-471 行）：`_interrupt_requested` 标志被设置。
4. **达到最大迭代次数**（第 461 行）：`api_call_count >= agent.max_iterations`。
5. **护栏拦截**（第 3709-3730 行）：工具护栏触发。
6. **空响应耗尽**（第 3970-4074 行）：3 次重试 + 降级尝试后仍为空。
7. **接近最大迭代次数时出错**（第 4191-4197 行）：外层循环异常。

### 1.5 迭代预算机制

**文件：** `agent/iteration_budget.py:17-63`

```python
class IterationBudget:
    def __init__(self, max_total: int):
        self.max_total = max_total
        self._used = 0
        self._lock = threading.Lock()

    def consume(self) -> bool:
        with self._lock:
            if self._used >= self.max_total:
                return False
            self._used += 1
            return True

    def refund(self) -> None:
        """退还一次迭代（例如用于 execute_code 轮次）。"""
```

- 父 agent 预算：`max_iterations`（默认 90）。
- 子 agent 预算：`delegation.max_iterations`（默认 50），相互独立。
- `execute_code` 工具调用会被退款（第 3749-3750 行），因为它们是廉价的 RPC 风格调用。

### 设计决策
- **线程安全预算**：需要此机制是因为子 agent 在并行线程中运行。
- **execute_code 退款**：防止程序化工具使用消耗对话预算。
- **Grace call**：即使预算耗尽，也给模型最后一次收尾的机会。

### 优势
- 外层迭代与内层重试关注点分离清晰。
- 预算机制防止失控循环消耗 API 额度。
- 中断处理响应迅速（在退避期间每 200ms 检查一次）。

### 劣势
- 单一的 `max_iterations` 上限有些粗略；没有按工具类型分配的预算。
- 循环体非常长（约 3,700 行），难以阅读。

---

## 2. 系统提示词构建

### 2.1 架构

**文件：** `agent/system_prompt.py`, `agent/prompt_builder.py`

系统提示词每会话构建一次，并在各轮次间缓存。它分为三个层级（`system_prompt.py` 第 62-350 行）：

1. **稳定层** — 身份、工具指导、技能提示词、环境提示、平台提示、模型家族操作指导。
2. **上下文层** — 调用方提供的 `system_message` 加上上下文文件（AGENTS.md、.cursorrules 等）。
3. **易变层** — 记忆快照、用户画像、外部记忆提供程序块、时间戳行。

### 2.2 缓存策略

**文件：** `agent/system_prompt.py:225-338`

```python
def _restore_or_build_system_prompt(agent, system_message, conversation_history):
    stored_prompt = None
    stored_state = "missing"
    if conversation_history and agent._session_db:
        session_row = agent._session_db.get_session(agent.session_id)
        if session_row is not None:
            raw_prompt = session_row.get("system_prompt")
            if raw_prompt is None:
                stored_state = "null"
            elif raw_prompt == "":
                stored_state = "empty"
            else:
                stored_prompt = raw_prompt
                stored_state = "present"

    if stored_prompt:
        agent._cached_system_prompt = stored_prompt
        return
    # 全新构建并持久化到数据库
    agent._cached_system_prompt = agent._build_system_prompt(system_message)
```

提示词存储在 SQLite 中（第 330 行的 `update_system_prompt`），并在会话恢复时原样还原。这确保了在 Anthropic 等提供程序上获得前缀缓存命中。

### 2.3 模型家族专属指导

**文件：** `agent/system_prompt.py:156-183`

```python
if agent.valid_tool_names:
    _enforce = agent._tool_use_enforcement
    _inject = False
    # 可配置：auto/true/false/list
    if _enforce is True or (isinstance(_enforce, str) and _enforce.lower() in {"true", "always", "yes", "on"}):
        _inject = True
    elif isinstance(_enforce, list):
        model_lower = (agent.model or "").lower()
        _inject = any(p.lower() in model_lower for p in _enforce if isinstance(p, str))
    else:
        # "auto" — 使用硬编码默认值
        model_lower = (agent.model or "").lower()
        _inject = any(p in model_lower for p in TOOL_USE_ENFORCEMENT_MODELS)
    if _inject:
        stable_parts.append(TOOL_USE_ENFORCEMENT_GUIDANCE)
        if "gemini" in _model_lower or "gemma" in _model_lower:
            stable_parts.append(GOOGLE_MODEL_OPERATIONAL_GUIDANCE)
        if "gpt" in _model_lower or "codex" in _model_lower or "grok" in _model_lower:
            stable_parts.append(OPENAI_MODEL_EXECUTION_GUIDANCE)
```

**工具使用强制模型**（`prompt_builder.py:274`）：
```python
TOOL_USE_ENFORCEMENT_MODELS = ("gpt", "codex", "gemini", "gemma", "grok", "glm", "qwen", "deepseek")
```

### 2.4 上下文文件发现

**文件：** `agent/prompt_builder.py:64-116`

在 `TERMINAL_CWD` 下发现上下文文件：

```python
def _find_hermes_md(cwd: Path) -> Optional[Path]:
    """发现最近的 .hermes.md 或 HERMES.md。
    搜索顺序：先从 cwd 开始，然后向上遍历每个父目录直到（并包括）git 仓库根目录。
    """
    stop_at = _find_git_root(cwd)
    current = cwd.resolve()
    for directory in [current, *current.parents]:
        for name in _HERMES_MD_NAMES:
            candidate = directory / name
            if candidate.is_file():
                return candidate
        if stop_at and directory == stop_at:
            break
    return None
```

**安全扫描**（`prompt_builder.py:45-61`）：所有上下文文件在注入前都会扫描提示注入 / 提示软件：
```python
def _scan_context_content(content: str, filename: str) -> str:
    findings = _scan_for_threats(content, scope="context")
    if findings:
        return f"[已阻止：{filename} 包含潜在的提示注入（{', '.join(findings)}）。内容未加载。]"
    return content
```

### 设计决策
- **三层结构**：将缓存友好的稳定内容与每会话上下文和每轮次易变内容分离。
- **仅日期时间戳**（第 337 行）：使用 `%A, %B %d, %Y` 而非分钟级精度，以保持提示词字节稳定以获得缓存命中。
- **模型专属指导**：仅针对已知有问题的模型家族注入，为表现良好的模型保持提示词精简。

### 优势
- 前缀缓存优化：稳定层永不更改，最大化 KV 缓存复用。
- 安全扫描防止来自克隆仓库文件的提示注入。
- SQLite 中的持久缓存支持会话恢复而无需重建。

### 劣势
- 上下文文件发现是同步且绑定文件系统的；没有异步选项。
- 稳定层在启用大量工具/技能时可能变得非常大。

---

## 3. 错误处理与重试策略

### 3.1 错误分类

**文件：** `agent/error_classifier.py:24-65`

`FailoverReason` 枚举提供了结构化的分类体系：

```python
class FailoverReason(enum.Enum):
    auth = "auth"                          # 瞬时认证（401/403）
    auth_permanent = "auth_permanent"      # 刷新后认证仍失败
    billing = "billing"                    # 402 或额度耗尽
    rate_limit = "rate_limit"              # 429 或配额限流
    overloaded = "overloaded"              # 503/529
    server_error = "server_error"          # 500/502
    timeout = "timeout"                    # 连接/读取超时
    context_overflow = "context_overflow"  # 上下文过大
    payload_too_large = "payload_too_large"  # 413
    image_too_large = "image_too_large"   # 单张图片大小限制
    model_not_found = "model_not_found"    # 404 或无效模型
    provider_policy_blocked = "provider_policy_blocked"
    content_policy_blocked = "content_policy_blocked"
    format_error = "format_error"          # 400 错误请求
    # ... 提供程序特定原因
```

**分类流水线**（第 441-700 行）：按优先级排序：
1. 提供程序特定模式（思考签名、层级门控）
2. HTTP 状态码 + 消息感知细化
3. 错误码分类
4. 消息模式匹配（计费 vs 速率限制 vs 上下文 vs 认证）
5. SSL/TLS 瞬时告警模式
6. 服务器断开 + 大会话 → 上下文溢出
7. 传输错误启发式
8. 回退：unknown（带退避可重试）

### 3.2 重试策略：指数退避 + 抖动

**文件：** `agent/retry_utils.py:19-57`

```python
def jittered_backoff(attempt: int, *, base_delay: float = 5.0, max_delay: float = 120.0, jitter_ratio: float = 0.5) -> float:
    exponent = max(0, attempt - 1)
    delay = min(base_delay * (2 ** exponent), max_delay)
    seed = (time.time_ns() ^ (tick * 0x9E3779B9)) & 0xFFFFFFFF
    rng = random.Random(seed)
    jitter = rng.uniform(0, jitter_ratio * delay)
    return delay + jitter
```

用于两种场景：
- **无效响应**：base_delay=5.0, max_delay=120.0（第 1248 行）
- **速率限制**：base_delay=2.0, max_delay=60.0（第 3202 行）
- **尊重 Retry-After 头**：如果存在，上限为 120 秒（第 3191-3201 行）

### 3.3 截断（finish_reason="length"）处理

**文件：** `agent/conversation_loop.py:1315-1564`

当 `finish_reason == "length"` 时：

1. **检测思考预算耗尽**（第 1349-1408 行）：如果模型将所有输出 token 用于推理而没有剩余用于响应，则返回用户友好的错误，而不是浪费重试。

2. **文本续接**（第 1410-1469 行）：对于非工具调用响应，追加部分内容并发送续接提示：
```python
_continue_content = _get_continuation_prompt(_is_partial_stream_stub, _dropped_tools)
continue_msg = {"role": "user", "content": _continue_content}
messages.append(continue_msg)
```
限制为 3 次续接尝试。

3. **截断工具调用重试**（第 1471-1534 行）：如果工具调用被截断，提升 `max_tokens` 并在不追加损坏响应的情况下重试。

### 3.4 空响应处理

**文件：** `agent/conversation_loop.py:3818-4074`

多层恢复：
1. **部分流恢复**：使用已流式传输的内容（如果可用）。
2. **前一轮内容回退**：使用来自前一次内务工具轮次的内容。
3. **工具后空值提示**：注入合成用户消息提示模型继续。
4. **仅思考预填充**：对于带推理字段的模型，追加并继续。
5. **空响应重试**：最多 3 次重试。
6. **回退提供程序**：如果空响应持续存在，切换到回退提供程序。

### 3.5 回退提供程序切换

**文件：** `agent/chat_completion_helpers.py`（回退激活）

回退链在 `config.yaml` 中配置。以下情况会积极激活：
- 计费额度耗尽
- 速率限制（当凭证池无法恢复时）
- 无效/空响应
- 达到最大重试次数

```python
if agent._try_activate_fallback():
    retry_count = 0
    compression_attempts = 0
    _retry.primary_recovery_attempted = False
    continue
```

### 设计决策
- **结构化分类**：用单一分类体系替代分散的字符串匹配。
- **抖动解耦**：并发的重试去相关，防止惊群效应。
- **一次性恢复守卫**（`TurnRetryState`）：防止在同一条恢复路径上无限循环。

### 优势
- 极其全面的错误覆盖（20+ 种失败原因）。
- 优雅降级：压缩 → 凭证轮换 → 回退 → 中止。
- 每条最终失败路径都有可操作的用户指导。

### 劣势
- 重试逻辑与主循环深度交织，使得单元测试困难。
- 某些恢复路径（例如思考签名剥离）是模型特定的 hack。

---

## 4. 上下文压缩

### 4.1 架构

**文件：** `agent/context_compressor.py`, `agent/context_engine.py`

`ContextEngine`（`context_engine.py:32-227`）是抽象基类。`ContextCompressor`（`context_compressor.py:522-`）是默认实现。

### 4.2 触发条件

压缩在以下情况触发：
1. **主动阈值**：当 `prompt_tokens >= threshold_tokens`（默认为上下文长度的 50%）时，`should_compress()` 返回 True。
2. **提供程序溢出**：来自 API 的上下文长度错误触发立即压缩。
3. **负载过大**：HTTP 413 触发压缩。

**文件：** `agent/context_compressor.py:744-764`
```python
def should_compress(self, prompt_tokens: int = None) -> bool:
    tokens = prompt_tokens if prompt_tokens is not None else self.last_prompt_tokens
    if tokens < self.threshold_tokens:
        return False
    # 防抖：如果最近 2 次压缩每次节省 <10%
    if self._ineffective_compression_count >= 2:
        return False
    return True
```

### 4.3 上下文窗口管理

**文件：** `agent/context_compressor.py:600-698`

```python
def __init__(self, model: str, threshold_percent: float = 0.50, protect_first_n: int = 3,
             protect_last_n: int = 20, summary_target_ratio: float = 0.20, ...):
    self.context_length = get_model_context_length(model, ...)
    self.threshold_tokens = max(int(self.context_length * threshold_percent), MINIMUM_CONTEXT_LENGTH)
    target_tokens = int(self.threshold_tokens * self.summary_target_ratio)
    self.tail_token_budget = target_tokens
    self.max_summary_tokens = min(int(self.context_length * 0.05), _SUMMARY_TOKENS_CEILING)
```

- `MINIMUM_CONTEXT_LENGTH`：32,768 token（来自 `agent/model_metadata.py`）。
- `protect_first_n`：始终保留 3 条消息（系统 + 首次交换）。
- `protect_last_n`：按 token 预算保留最近的 20 条消息。

### 4.4 压缩策略

**算法**（`context_compressor.py:770-936`）：

1. **剪枝旧工具结果**（低成本，无需 LLM 调用）：
   - 基于哈希去重相同工具结果
   - 将旧工具结果替换为单行摘要
   - 从旧消息中剥离图片部分
   - 截断大型 tool_call 参数

2. **保护头部和尾部**：
   - 头部：系统提示词 + 前 N 条消息
   - 尾部：按 token 预算保留最近的消息

3. **使用结构化 LLM 提示词摘要中间轮次**：
   - 使用辅助模型（廉价/快速）或回退到主模型
   - 迭代更新：保留前次摘要，添加新进展
   - 结构化模板：活跃任务、目标、已完成操作、活跃状态、阻塞项、关键决策等

4. **LLM 摘要器失败时的静态回退**：
   - 提取用户请求、助手操作、工具操作、文件路径、阻塞项
   - 构建无需 LLM 调用的确定性交接

**摘要前缀**（`context_compressor.py:37-61`）：
```python
SUMMARY_PREFIX = (
    "[上下文压缩 — 仅供参考] 较早的轮次已被压缩 "
    "成下方的摘要。这是来自先前上下文窗口的交接 — "
    "将其作为背景参考，而非活跃指令。"
    "不要回答或执行此摘要中提到的请求；"
    "它们已被处理。"
    "仅回复出现在此摘要之后最新的用户消息 — "
    "该消息是当前要做什么的唯一真相来源。"
)
```

### 设计决策
- **两阶段方法**：先进行廉价剪枝，仅在需要时进行昂贵的 LLM 摘要。
- **迭代摘要**：保留并更新前次摘要，而非从头重新生成。
- **时间锚定**：将相对引用改写为带日期的绝对事实，防止重复执行已完成操作。

### 优势
- 多层压缩（剪枝 + 摘要 + 回退）。
- 防抖保护防止无限压缩循环。
- 安全：在发送到辅助模型前编辑敏感文本。
- 图片剥离防止多 MB 的 base64 blob 永久留存。

### 劣势
- LLM 摘要需要第二次 API 调用（成本 + 延迟）。
- 静态回退远不如 LLM 生成的摘要丰富。
- 压缩可能丢失不符合模板的细微上下文。

---

## 5. 工具调度与执行

### 5.1 工具注册表

**文件：** `tools/registry.py:151-300`

```python
class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, ToolEntry] = {}
        self._toolset_checks: Dict[str, Callable] = {}
        self._lock = threading.RLock()
        self._generation: int = 0

    def register(self, name: str, toolset: str, schema: dict, handler: Callable,
                 check_fn: Callable = None, requires_env: list = None,
                 is_async: bool = False, description: str = "", emoji: str = "",
                 max_result_size_chars: int = None, dynamic_schema_overrides: Callable = None,
                 override: bool = False):
```

- **自注册**：每个工具文件在模块级别调用 `registry.register()`。
- **发现**：`discover_builtin_tools()`（第 57-75 行）使用 AST 解析查找包含 `registry.register()` 调用的模块。
- **check_fn TTL 缓存**：环境探测的 30 秒缓存（第 121-148 行）。
- **世代计数器**：每次变更时递增用于缓存失效。
- **覆盖保护**：防止意外遮蔽，除非 `override=True`。

### 5.2 工具执行

**文件：** `agent/tool_executor.py:243-699`

两种执行模式：

**顺序执行**（`_execute_tool_calls_sequential`）：用于有依赖关系或交互式工具的批次。

**并发执行**（`execute_tool_calls_concurrent`，第 243 行）：使用最多 8 个 worker 的 `ThreadPoolExecutor`。

并行执行由安全规则把关（`agent/tool_dispatch_helpers.py:103-146`）：
```python
def _should_parallelize_tool_batch(tool_calls) -> bool:
    if len(tool_calls) <= 1:
        return False
    tool_names = [tc.function.name for tc in tool_calls]
    if any(name in _NEVER_PARALLEL_TOOLS for name in tool_names):
        return False
    # 路径作用域工具：检查重叠路径
    if tool_name in _PATH_SCOPED_TOOLS:
        scoped_path = _extract_parallel_scope_path(tool_name, function_args)
        if any(_paths_overlap(scoped_path, existing) for existing in reserved_paths):
            return False
```

**永不并行工具**：`clarify`（面向用户）。  
**并行安全工具**：`read_file`, `search_files`, `web_search`, `web_extract`, `vision_analyze` 等。  
**路径作用域工具**：`read_file`, `write_file`, `patch` — 可在独立路径上并发运行。

### 5.3 工具结果格式化

**文件：** `agent/tool_dispatch_helpers.py:320-397`

```python
def make_tool_result_message(name: str, content: Any, tool_call_id: str) -> dict:
    wrapped = _maybe_wrap_untrusted(name, content)
    return {
        "role": "tool",
        "name": name,
        "tool_name": name,
        "content": wrapped,
        "tool_call_id": tool_call_id,
    }
```

**不可信内容包装**（第 372-397 行）：高风险工具（`web_extract`, `web_search`, `browser_*`, `mcp_*`）会被包裹在 `<untrusted_tool_result>` 分隔符中，以防止间接提示注入。

### 5.4 并行工具执行细节

**文件：** `agent/tool_executor.py:450-624`

```python
with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
    for i, tc, name, args in runnable_calls:
        f = executor.submit(
            propagate_context_to_thread(_run_tool), i, tc, name, args, parsed_calls[i][3]
        )
        futures.append(f)
```

- ContextVars 传播到 worker 线程（用于审批/sudo 回调）。
- 中断处理：每线程中断信号，每 5 秒心跳检测。
- 执行后：护栏观察、文件变更跟踪、进度回调。

### 设计决策
- **注册表模式**：解耦工具定义与工具消费。
- **并行安全规则**：保守默认（顺序执行），安全并发白名单。
- **不可信包装**：针对 web/MCP 内容间接提示注入的架构防御。

### 优势
- 清晰的注册表，支持自注册和基于 AST 的发现。
- 智能并行化，支持路径重叠检测。
- 全面的中间件钩子（工具调用前/后）。
- 中断安全的并发执行。

### 劣势
- 小批次的 ThreadPoolExecutor 开销。
- 路径重叠检测基于字符串，而非文件系统感知。
- 工具结果可能变得非常大，消耗上下文窗口。

---

## 6. 流式传输支持

### 6.1 流式传输实现

**文件：** `agent/conversation_loop.py:958-1025`

即使没有消费者，Hermes 也优先使用流式传输：
```python
# 始终优先使用流式传输路径 — 即使没有流消费者。
# 流式传输提供细粒度的健康检查（90 秒流停滞检测，60 秒读取超时）
_use_streaming = True
```

以下情况禁用流式传输：
- 已发出"流不支持"信号的提供程序（`_disable_streaming` 标志）
- Copilot ACP 客户端（子进程 stdio）
- 测试中的 Mock 客户端

### 6.2 流式传输期间的中断处理

**文件：** `agent/chat_completion_helpers.py:125-191`

```python
def interruptible_api_call(agent, api_kwargs: dict):
    result = {"response": None, "error": None}
    request_client_holder = {"client": None, "owner_tid": None}
    _request_cancelled = {"value": False}

    def _call():
        try:
            request_client = _set_request_client(agent._create_request_openai_client(...))
            response = request_client.chat.completions.create(**api_kwargs)
            result["response"] = response
        except Exception as e:
            result["error"] = e
        finally:
            _close_request_client_once(reason="request_complete")
```

- API 调用在后台线程中运行，以便主循环可以检测中断。
- 每个 worker 线程获得自己的 OpenAI 客户端实例。
- 中断仅关闭 worker 本地客户端，不影响共享状态。
- 陈旧调用检测器：如果在配置的超时时间内无响应，则终止连接。

### 6.3 流式增量处理

**文件：** `agent/stream_diag.py:24-280`

流诊断跟踪：
- `cf-ray`, `cf-cache-status`, `x-openrouter-provider`, `x-openrouter-model`
- 丢弃前接收到的字节/块数
- 首字节时间（TTFB）
- 异常链（扁平化用于调试）

```python
def stream_diag_init() -> Dict[str, Any]:
    return {
        "started_at": time.time(),
        "first_chunk_at": None,
        "chunks": 0,
        "bytes": 0,
        "headers": {},
        "http_status": None,
    }
```

### 设计决策
- **流式传输作为默认**：提供非流式传输所缺乏的健康检查。
- **每次请求客户端隔离**：防止中断污染其他请求。
- **陌生线程关闭**：当中断来自不同线程时，仅关闭套接字（而非完全关闭），避免 FD 回收竞争。

### 优势
- 响应迅速的中断处理（200ms 检查间隔）。
- 丰富的流诊断用于调试提供程序问题。
- 陈旧调用检测防止无限挂起。

### 劣势
- 流式传输为提供程序的部分/非标准实现增加了复杂性。
- 流在工具调用中途丢弃需要特殊的恢复逻辑。

---

## 7. 事件/扩展系统

### 7.1 插件钩子系统

**文件：** `hermes_cli/plugins`（钩子分发）

插件从 `plugins/` 目录加载。Agent 循环调用的关键钩子：

### 7.2 可用钩子

**LLM 调用前钩子：**
- `on_session_start`（`conversation_loop.py:301-309`）：每个新会话触发一次。
- `pre_llm_call`：插件可以向用户消息注入上下文。
- `pre_api_request`（`conversation_loop.py:899-953`）：每次 API 调用前触发，携带完整请求上下文。

**LLM 调用后钩子：**
- `post_api_request`（`conversation_loop.py:3312-3351`）：每次 API 响应后触发。

**工具钩子：**
- `pre_tool_call`：插件可以阻止工具执行。
- `post_tool_call`：工具执行后触发。

**示例 — Langfuse 插件**（`plugins/observability/langfuse/__init__.py`）：
```python
# 追踪对话、LLM 调用和工具使用到 Langfuse
# 使用：on_session_start, pre_api_request, post_api_request, pre_tool_call, post_tool_call
```

### 7.3 插件如何修改行为

**上下文注入**（`conversation_loop.py:615-627`）：
```python
if idx == current_turn_user_idx and msg.get("role") == "user":
    _injections = []
    if _ext_prefetch_cache:
        _fenced = build_memory_context_block(_ext_prefetch_cache)
        if _fenced:
            _injections.append(_fenced)
    if _plugin_user_context:
        _injections.append(_plugin_user_context)
    if _injections:
        _base = api_msg.get("content", "")
        api_msg["content"] = _base + "\n\n" + "\n\n".join(_injections)
```

插件上下文被注入到用户消息中，而非系统提示词，以保留前缀缓存。

**工具拦截**（`agent/tool_executor.py:346-391`）：
```python
block_message = get_pre_tool_call_block_message(function_name, function_args, ...)
if block_message is not None:
    block_result = json.dumps({"error": block_message}, ensure_ascii=False)
    # 工具在执行前被拦截
```

### 7.4 插件工具

**文件：** `plugins/plugin_utils.py:43-136`

供插件作者使用的线程安全单例原语：
```python
def lazy_singleton(factory: Callable[[], T]) -> Callable[[], T]:
    """带双检锁的线程安全惰性单例。"""

class SingletonSlot(Generic[T]):
    """用于键控访问器的线程安全惰性槽。"""
```

### 设计决策
- **基于钩子的架构**：插件注册回调而非子类化。
- **用户消息注入**：保留系统提示词缓存稳定性。
- **故障开放**：插件钩子故障被捕获并记录，不会导致 agent 崩溃。

### 优势
- 核心 agent 与扩展之间的清晰分离。
- 多个捆绑插件（Langfuse、记忆、web 搜索等）。
- 线程安全工具防止常见的插件并发错误。

### 劣势
- 钩子系统无类型；插件依赖约定。
- 无插件隔离（插件在同进程中运行）。
- 插件加载在启动时即完成，非按钩子惰性加载。

---

## 总结对比表

| 方面 | Hermes 实现 | 显著特点 |
|------|-----------|---------|
| **循环** | 外层迭代 + 内层重试，约 3,700 行 | 非常全面，略显单体 |
| **预算** | 线程安全 `IterationBudget` 支持退款 | 父/子 agent 独立预算 |
| **系统提示词** | 三层（稳定/上下文/易变），SQLite 缓存 | 前缀缓存优化，安全扫描 |
| **错误分类** | `FailoverReason` 枚举，20+ 种原因 | 优先级排序流水线，非常彻底 |
| **重试** | 抖动指数退避 | 解耦并发重试 |
| **上下文压缩** | 剪枝 + LLM 摘要 + 静态回退 | 迭代摘要，防抖 |
| **工具注册表** | 自注册 + AST 发现 | 世代计数器用于缓存失效 |
| **并行工具** | ThreadPoolExecutor，路径重叠检测 | 保守门控，中断安全 |
| **流式传输** | 优先路径，每次请求客户端隔离 | 丰富的诊断，陈旧调用检测 |
| **插件** | 基于钩子（API 前/后，工具前/后） | 故障开放，仅用户消息注入 |

---

## 关键文件参考

| 组件 | 主文件 | 行数 |
|------|--------|------|
| ReAct 循环 | `agent/conversation_loop.py` | ~4,200 |
| 系统提示词 | `agent/system_prompt.py` | ~413 |
| 提示词构建器 | `agent/prompt_builder.py` | ~600 |
| 错误分类器 | `agent/error_classifier.py` | ~700 |
| 重试工具 | `agent/retry_utils.py` | ~58 |
| 迭代预算 | `agent/iteration_budget.py` | ~63 |
| 上下文压缩器 | `agent/context_compressor.py` | ~1,600 |
| 上下文引擎（ABC） | `agent/context_engine.py` | ~227 |
| 工具注册表 | `tools/registry.py` | ~300 |
| 工具执行器 | `agent/tool_executor.py` | ~700 |
| 工具调度助手 | `agent/tool_dispatch_helpers.py` | ~418 |
| 轮次重试状态 | `agent/turn_retry_state.py` | ~69 |
| 流诊断 | `agent/stream_diag.py` | ~281 |
| 聊天完成助手 | `agent/chat_completion_helpers.py` | ~700 |
| 插件工具 | `plugins/plugin_utils.py` | ~136 |
