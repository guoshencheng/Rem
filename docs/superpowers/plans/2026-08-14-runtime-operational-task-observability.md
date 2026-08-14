# 第四阶段：Operational Task API 与生产可观测性

## 目标

在现有持久化 Run 生命周期之上提供高层 `tasks.start/wait/execute` 组合 API、主 Artifact
结果读取、waiting 处置后的可恢复等待，以及宿主侧脱敏 Runtime Observer 和健康检查。Task
不创建第二套执行状态机；Run、Journal、ToolInvocation 和 Artifact 继续作为事实来源。

## 已实现的边界

- Core 导出 `StartTaskInput`、`TaskOutcome`、`RuntimeTaskOperations`，嵌入式 Runtime 通过
  `scoped.tasks` 暴露；`execute` 等价于 `runs.start` 后等待持久化终态。
- RuntimeClient 通过既有 `/v1/runs`、`/stream`、Artifact 和 ToolInvocation 路径组合相同
  Task API，不增加 `/v1/tasks`。SSE 断开时回退状态查询，调用方 Abort 不取消 Run。
- JSON、文本和 URI 主 Artifact 使用同一结果契约；waiting 返回当前 unknown invocations。
- `RuntimeObserver` 为非持久化 best-effort 宿主端口，按注册顺序深隔离投影 Runtime、Run、
  Model、Tool、Worker 事件；prompt、输入/结果、Artifact、claims、凭证和内部 cause 不进入
  事件。内置 JSON-line observer 复用现有 debug 日志路径。
- `RuntimeHealth` 由 Runtime 返回；Storage Provider 提供 `checkHealth()`，Service 的
  `/v1/health` 不需要认证，ready 返回 200，其他状态返回 503；Client 对两种响应使用同一
  解码器。

## 验收

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm check:structure
git diff --check
```

本阶段不包含 Webhook、Outbox、连接器 SDK、OpenTelemetry、PostgreSQL、多 Worker 或 Web
Workbench 改造；这些能力在后续运营与交付阶段单独设计。
