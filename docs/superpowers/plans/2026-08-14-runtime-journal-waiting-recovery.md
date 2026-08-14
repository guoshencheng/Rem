# 第二阶段：可恢复 Execution Journal 与 Waiting 闭环实施计划

**目标：** 让持久化 Journal 成为所有执行节点的精确恢复点；Runtime 重启后不重复已完成的模型调用或工具副作用，并完整支持 unknown 工具结果的人工处置。

**架构：** 保持一个 root Run，通过 node-scoped Journal、ToolInvocation 和持久化预算恢复 single、Team member/organizer 与 child。第二阶段不重做 Team 调度策略，只统一它们依赖的检查点和恢复基础。

## 实施任务

- 持久化 Journal writer、按 node 分页读取、Execution Budget 与 SQLite v13/Fake 契约。
- 建立 checkpoint reader，恢复 pending tool calls、已完成 assistant、submit_result 和 Artifact。
- 以 Journal 驱动 Session projection，覆盖 single、Team organizer 和 delegated node 隔离。
- 收敛 recovery、waiting、confirm/retry/fail、幂等键和 waiting cancel 语义。
- 让 Team/child 使用确定性 node/delivery 恢复，并补齐 Service、Client、Workbench 回归。

## 验收

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm check:structure
git diff --check
```

waiting Run 的普通 cancel 返回 `TOOL_RESULT_UNKNOWN`；旧 AgentSystem 数据和高频 Signal 不迁移、不持久化。
