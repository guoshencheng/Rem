# 真实 LLM Agent 纯观测入口设计

## 目标

将 `pnpm test:agent:live` 从带内存测试工具和自动断言的 Harness，调整为一个手动使用的真实 LLM 观测入口：提交一项任务，展示完整 Agent 事件流和最终输出。

## 范围与边界

- 命令仅接受必填参数 `--task <text>`；保留 pnpm 转发产生的前置 `--` 兼容。
- 删除 `--data`、`--expect-result`、`--keep-output`，不再提供 fixture、结构化结果断言或 `PASS`/`FAIL` 摘要。
- 不注入 `get_test_data`、`record_result` 或任何其他测试工具。
- 通过 `AgentToolCapabilities` 关闭 `read_skill`、`delegate_task` 和 `todowrite`，因此模型本轮没有可调用工具，也不能读写文件、执行 Shell、读取技能或触发子 Agent。
- 保持真实 Provider 的 Core 配置路径不变：`createAgentFromEnv()` 负责解析模型、认证和 base URL，脚本不读取密钥。
- 一次运行所需的 SQLite storage 继续位于临时目录，并在退出时删除。

## 输出与退出状态

脚本消费并输出 Agent 产生的每一个事件。对于工具开始、工具结束、完成和错误事件，使用中文摘要；其他事件以 JSON 输出，方便完整检查流式消息和 turn 生命周期。

正常完成时输出最终文本并以状态码 0 退出。Provider 配置缺失、认证/网络失败或 Agent 自身发出 `error` 事件时，输出错误与最终文本（若有）并以状态码 1 退出。脚本不会根据模型是否调用工具或文本内容判定失败。

## 测试策略

- 更新参数解析测试，覆盖仅接受 `--task`、拒绝已删除选项和 pnpm 分隔符兼容。
- 更新 Agent 工具能力测试，验证纯观测 run 的工具列表为空。
- 更新输出测试，验证普通流式事件会被格式化为 JSON，完成和错误事件仍保留可读摘要。
- 删除专为 fixture Provider 和结果断言服务的实现与测试。
- 运行 `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`；使用已配置 Provider 手动执行 `pnpm test:agent:live -- --task '你好'`，确认获得真实流式输出和最终结果。
