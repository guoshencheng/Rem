# Rem Agent

一个 Agent-first 的 TypeScript 通用 Agent Harness 系统。

## 目标

- 核心聚焦 Agent 推理循环、状态、事件、预算与工具
- 通过稳定的 SDK 接口支持扩展
- TypeScript/Node.js 实现，本地个人运行

## 环境要求

- Node.js >= 22.19.0
- pnpm

## 包结构

```text
packages/
  core/    — rem-agent-core：Agent 生命周期、ReAct 循环、事件、预算、LLM 抽象层
  bridge/  — rem-agent-bridge：IAgentService、HTTP client/server、SSE 编解码、LocalAgentService
  routes/  — rem-agent-routes：REM API 路由包（createRemHandler + rem-routes init CLI）
  ui/      — rem-agent-ui：React 聊天组件包（RemApp / RemChat / RemLocalApp / RemLocalChat）
  web/     — rem-agent-web：Next.js 15 + React 19 宿主应用（薄组合层）
  local-demo/ — rem-agent-local-demo：纯前端 Vite demo（浏览器内跑 Agent）
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

# 启动纯前端本地 demo（浏览器内跑 Agent）
pnpm --filter rem-agent-local-demo dev
```

## 文档

- [系统架构](docs/architecture.md)
- [模块参考手册](docs/module-reference.md)
- [Core API](packages/core/README.md)
- [Core 层早期设计（历史）](docs/core-design.md)

## 开发命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 运行所有测试 |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm --filter rem-agent-core typecheck` | 仅检查 core |
| `pnpm --filter rem-agent-web dev` | 启动 Web UI |
