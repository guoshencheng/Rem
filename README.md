# Rem Agent

一个 Agent-first 的 TypeScript 通用 Agent Harness。项目当前处于 Core-first 重建阶段，活动 workspace 只保留 `rem-agent-core`；旧 Bridge、Routes、UI 和 Web 实现保存在 `archive/`。

## 目标

- Core 独立提供 Session、Agent 生命周期、事件、预算、工具与持久化能力
- 在 Core 中逐步建设单 Agent、一次性 child Agent 和 Organizer 驱动的长期多 Agent
- 传输协议和 UI 在 Core 公共 API 稳定后重新向上建设

## 环境要求

- Node.js >= 22.19.0
- pnpm

## 活动结构

```text
packages/
  core/    — rem-agent-core：完整 Agent Harness 的唯一活动实现
archive/   — 旧 Core、Bridge、Routes、UI、Web 实现，仅供历史参考
```

## 开发命令

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm check:structure
```

## 文档

- [Core Agent System 重建设计](docs/superpowers/specs/2026-07-31-core-agent-system-rebuild-design.md)
- [当前架构](docs/architecture.md)
- [Core 模块参考](docs/module-reference.md)
- [Core 早期设计（历史）](docs/core-design.md)
