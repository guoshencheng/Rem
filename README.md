# Rem Agent

一个 Agent-first 的 TypeScript 通用 Agent Harness 系统。

## 目标

- 核心聚焦 Agent 推理循环、记忆、工具、技能
- 通过稳定的 SDK 接口支持扩展
- TypeScript/Node.js 实现，本地个人运行
- 参考 Hermes Agent 的架构逻辑，吸收 OpenClaw 的插件边界设计

## 包结构

```text
packages/
  core/    — rem-agent-core：Agent 生命周期、ReAct 循环、事件、预算、LLM 抽象层
  bridge/  — rem-agent-bridge：HTTP client/server、SSE 编解码、AgentService
  web/     — rem-agent-web：Next.js 15 + React 19 聊天 UI
  tui/     — rem-agent-tui：基于 @opentui/core 的终端 UI 组件
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 类型检查 + 测试
pnpm typecheck
pnpm test

# 启动 Web UI（开发模式）
pnpm --filter rem-agent-web dev
```

## 文档

- [系统架构](docs/architecture.md)
- [Core 层设计](docs/core-design.md)
- [模块参考手册](docs/module-reference.md)
- [Core API](packages/core/README.md)

## 开发命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 运行所有测试 |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm --filter rem-agent-core typecheck` | 仅检查 core |
| `pnpm --filter rem-agent-web dev` | 启动 Web UI |
