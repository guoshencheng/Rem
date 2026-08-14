# 第三阶段：持久化 Execution Graph 与 Team 调度器实施计划

> 本计划在当前 `main` 上继续执行，保留第一、第二阶段的未提交修改。

**目标：** 将固定 Team fan-out 升级为 Organizer 驱动、可恢复的 root Run Execution Graph，并统一 Team、Member 与 child 的 Delivery、Journal、预算和等待语义。

**架构：** 一个 root Run 保持一个 WorkItem、租约、取消信号和预算。Organizer/Member 通过内部 `send_message` 创建持久化批次；同节点串行、跨节点受 `maxParallelAgents` 限制，批次完成后幂等创建 resume Delivery。ExecutionEntry、Delivery、Node 和 ToolInvocation 是恢复事实，高频 Signal 仍是可丢失投影。

**技术栈：** TypeScript、SQLite/Fake RuntimeStorage、pi-agent-core 无状态 loop、Vitest、现有 `/v1` Service/Client/Web。

---

## 实施任务

- [x] 扩展 ExecutionNode/Delivery/ExecutionPlan/Storage 契约，增加 Delivery 来源、请求者、结果、attempt 和 waiting 状态。
- [x] 升级 SQLite runtime schema 到 v14，并为已有 Runtime 数据提供安全的旧 Team 图恢复策略。
- [x] 建立中央消息投影、Delivery claim、batch completion、同节点串行和跨节点并发 Scheduler。
- [x] 注入严格 `send_message` 工具；Organizer 只有在无未完成 Delivery 时才能完成文本或结构化结果。
- [x] 将 Team executor 改为 Organizer-first 动态调度，统一失败、取消、预算和 Journal 投影。
- [x] 收敛 child delegation 的策略继承、`maxTurns` 覆盖、恢复和无死锁约束。
- [x] 更新 recovery、Service/Client 解码、Workbench Inspector 和架构文档。

## 验收

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm check:structure
git diff --check
```

必须覆盖 Organizer → 并行 Member → resume → Organizer 最终结果、多轮 batch、崩溃恢复、unknown 处置、预算/深度/并发边界，以及 child 不产生独立 Run/Session。
