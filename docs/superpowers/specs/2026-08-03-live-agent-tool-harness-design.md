# 真实 LLM Agent 工具测试 Harness 设计

## 目标

为 Core 提供一个手动运行的真实 LLM 冒烟测试入口。调用实际配置的 Provider，向 Agent 提交一项任务，并通过仅存在于内存的测试工具观测 Agent 的工具选择、调用参数、调用顺序和最终输出。

该入口用于开发者验证真实模型在当前 prompt、模型与工具协议下的行为，不替代无需密钥、可稳定在 CI 运行的 Vitest 单元测试。

## 范围与边界

- 新增根脚本 `pnpm test:agent:live`，显式执行才会发起网络请求和产生模型费用。
- 从 Core 的 `createAgentFromEnv()` 读取 Provider、模型和认证配置；脚本不得直接读取或解析 Provider 密钥。
- 不注册文件系统、Shell、技能、委派或编排工具。因此任务不会读写工作区，也不会执行宿主命令。
- Harness 通过 `AgentToolCapabilities` 关闭 `read_skill`、`delegate_task` 和 `todowrite`；模型可调用的工具仅为 `get_test_data` 与 `record_result`。
- 测试工具及调用记录只保存在当前进程。脚本退出后不保留工具副作用。
- 默认 Core 装配产生的 session/storage 行为维持既有语义；本功能不改变生产 Agent 的默认工具集。

## 命令接口

脚本接受以下参数：

- `--task <text>`：必填，提交给 Agent 的自然语言任务。
- `--data <json>`：可选，作为 `get_test_data` 的固定返回数据，缺省为内置示例数据。
- `--expect-result <json>`：可选，要求 `record_result` 的最后一次调用参数与该 JSON 深度相等。
- `--keep-output`：可选，保留完整事件输出；未指定时仍显示工具调用、终止状态和最终输出。

使用示例：

```bash
pnpm test:agent:live -- \
  --task '查询订单 A-100 的状态，并用 record_result 记录订单号和状态。' \
  --data '{"orders":{"A-100":{"status":"paid"}}}' \
  --expect-result '{"orderId":"A-100","status":"paid"}'
```

## 测试工具

Harness 在装配时传入独立的 `ToolProvider`，它只暴露两个工具：

1. `get_test_data`
   - 输入为可选的查询键。
   - 从命令行提供的 fixture 中返回数据，不进行文件或网络访问。
   - 每次调用都会被记录。
2. `record_result`
   - 输入为任意 JSON 对象，表达 Agent 认为完成任务所需提交的结构化结论。
   - 记录输入并返回确认文本。
   - 不写入磁盘，也不向外发送信息。

工具调用记录包含工具名、输入及其发生顺序。Harness 在 Agent 结束后输出该记录；提供 `--expect-result` 时，验证最后一次 `record_result` 调用。没有调用、参数不符、Agent 产生 `error` 事件或未完成都会使命令以非零状态结束。

## 运行流程

1. 参数解析与 JSON 校验；缺少 `--task` 或 JSON 不合法时立即报错。
2. 创建内存测试工具 Provider，调用 `createAgentFromEnv({ toolProvider })` 完成真实 Core 装配。
3. 创建一次性 session 和 `REMAgent`，以用户任务执行，并消费完整事件流。
4. 对 `tool_execution_start` / `tool_execution_end`、`error`、`finish` 等事件形成面向人的运行摘要；按选项输出其他事件。
5. 取得 Agent 最终输出，执行断言并写出摘要。无论成功或失败，进程内存工具状态都会随进程退出释放。

## 错误处理与安全性

- Provider 未配置、模型不存在、认证失败或网络失败时，保留 Core 返回的错误信息并以非零退出。
- `--data` 与 `--expect-result` 必须是 JSON；错误信息应指出对应参数。
- 工具实现不得调用文件系统、子进程或网络 API。
- 该 Harness 不是 OS 级沙箱；但它完全不向 Agent 提供能够产生宿主副作用的工具。

## 测试策略

- 为命令参数解析、内存工具调用记录、结果断言和退出状态编写 Vitest 单元测试，全部使用 faux / scripted 模型，不发起真实 LLM 请求。
- 不将 `test:agent:live` 纳入默认 `pnpm test`。
- 完成后运行 `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`；最后以缺少密钥时的预期配置错误，或在用户已配置 Provider 时的实际成功调用，手动验证 live 脚本。
