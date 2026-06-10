# Agent Harness System — 架构大纲

> 基于 Hermes Agent 和 OpenClaw 架构分析，采用 Plugin-Core Balance 方案。

---

## 1. 设计目标

构建一个 **Agent-first 的通用 Agent Harness 系统**：

- 核心聚焦 Agent 推理循环、记忆、工具、技能
- 通过稳定的 SDK 接口支持扩展
- TypeScript/Node.js 实现，本地个人运行
- 参考 Hermes Agent 的架构逻辑，吸收 OpenClaw 的插件边界设计

---

## 2. 核心设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 架构模式 | Plugin-Core Balance | 核心精简 + SDK 扩展边界 |
| 技术栈 | TypeScript/Node.js | 类型安全，参考 OpenClaw 实现 |
| 核心哲学 | Agent-first | 贴近 Hermes，Gateway 可选 |
| 部署模式 | 本地个人运行 | 专注核心，暂不考虑多租户 |
| 配置方式 | YAML + 环境变量 | 参考 Hermes `cli-config.yaml` |
| 记忆系统 | 三层记忆（Working/Episodic/Semantic） | Hermes 核心优势 |
| 技能系统 | SKILL.md + 自动生成 | Hermes 自学习闭环 |

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     INTERFACE 层（可选）                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               │
│  │   CLI   │ │Telegram │ │Discord  │ │  Web    │               │
│  │  (默认) │ │(插件)   │ │(插件)   │ │(插件)   │               │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘               │
│       └─────────────┴───────────┴───────────┘                   │
│                    │                                            │
│              ┌─────┴─────┐                                     │
│              │  Gateway  │  ← 通过 SDK 接入，非核心              │
│              │ (ChannelProvider)                               │
│              └─────┬─────┘                                     │
├────────────────────┼────────────────────────────────────────────┤
│                    │                                            │
│              ┌─────┴─────┐                                     │
│              │   Core    │  ← 核心引擎，不可替换                 │
│              │  Harness  │                                     │
│              └─────┬─────┘                                     │
│                    │                                            │
│    ┌───────────────┼───────────────┐                          │
│    │           SDK 层              │  ← 稳定扩展接口            │
│    │  ┌─────────┐ ┌─────────┐    │                          │
│    │  │ Memory  │ │  Tool   │    │                          │
│    │  │Provider │ │Provider │    │                          │
│    │  └─────────┘ └─────────┘    │                          │
│    │  ┌─────────┐ ┌─────────┐    │                          │
│    │  │Channel  │ │ Skill   │    │                          │
│    │  │Provider │ │Provider │    │                          │
│    │  └─────────┘ └─────────┘    │                          │
│    └───────────────┬───────────────┘                          │
│                    │                                            │
│    ┌───────────────┼───────────────┐                          │
│    │         Plugins 层            │  ← 内置 + 第三方           │
│    │  ┌─────────┐ ┌─────────┐    │                          │
│    │  │three-tier│ │ terminal│    │                          │
│    │  │ memory   │ │  tool   │    │                          │
│    │  └─────────┘ └─────────┘    │                          │
│    │  ┌─────────┐ ┌─────────┐    │                          │
│    │  │  web    │ │  file   │    │                          │
│    │  │  tool   │ │  tool   │    │                          │
│    │  └─────────┘ └─────────┘    │                          │
│    └───────────────────────────────┘                          │
│                                                               │
│    ┌───────────────────────────────────────┐                  │
│    │         State 层                      │  ← 数据持久化      │
│    │  ┌─────────────┐ ┌─────────────────┐  │                  │
│    │  │ SessionStore│ │  MemoryStore    │  │                  │
│    │  │ (消息历史)   │ │ (长期记忆/向量)  │  │                  │
│    │  └─────────────┘ └─────────────────┘  │                  │
│    │  ┌─────────────┐ ┌─────────────────┐  │                  │
│    │  │ ConfigStore │ │  SkillStore     │  │                  │
│    │  │ (配置/凭证)  │ │ (技能/元数据)    │  │                  │
│    │  └─────────────┘ └─────────────────┘  │                  │
│    │         ↓ SQLite + 文件系统            │                  │
│    └───────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

**设计原则：**

1. Core 最小化 — 只包含 Agent 生命周期、事件循环、状态机
2. SDK 稳定 — 四个接口定义清晰边界，变更需版本化
3. Plugin 可替换 — 所有能力通过插件实现，包括默认能力
4. Gateway 可选 — 不启动 Gateway 时，CLI 是唯一入口

---

## 4. 模块说明

### Core 层

| 文件 | 职责 | 关键能力 |
|------|------|---------|
| `harness.ts` | **生命周期管理** | 创建、运行、暂停、恢复、停止、重置 |
| `loop.ts` | **ReAct 循环执行** | 准备→推理→计划→执行→观察→反思 |
| `state.ts` | **会话状态管理** | 消息历史、预算、状态机、检查点 |
| `events.ts` | **事件总线** | 插件钩子的分发、优先级管理 |

### SDK 层

| 接口 | 职责 |
|------|------|
| `MemoryProvider` | 记忆管理（系统提示构建、预取、同步） |
| `ToolProvider` | 工具管理（定义发现、执行） |
| `ChannelProvider` | 通道管理（启动/停止、消息收发） |
| `SkillProvider` | 技能管理（发现、加载、注册） |

### State 层

| 组件 | 职责 | 被谁使用 |
|------|------|---------|
| `SessionStore` | 会话消息存储、历史查询 | Core (初始化/保存)、Interface (历史列表) |
| `MemoryStore` | 长期记忆、向量存储、FTS5 | MemoryProvider (插件) |
| `ConfigStore` | 配置加载、环境变量、凭证 | Core 初始化、Interface |
| `SkillStore` | 技能发现、加载、元数据 | SkillProvider (插件) |

**设计原则：**
- State 层是**被动**的 — 只提供 CRUD，不主动触发任何逻辑
- Core 通过事件钩子间接驱动保存（`after:turn` → 保存消息）
- Interface 层可以直接查询 State（如 `/history` 命令）

### 记忆系统

```
┌─────────────────────────────────────────┐
│         Layer 1: Working Memory         │
│         (会话级上下文)                   │
│  • 当前对话消息列表                      │
│  • 活跃任务状态                         │
│  • ~128K token limit                    │
├─────────────────────────────────────────┤
│         Layer 2: Episodic Memory        │
│         (跨会话经验)                     │
│  • Vector store (SQLite + FTS5)         │
│  • 具体任务经验 + 结果                   │
│  • 情感评分（成功/失败）                 │
│  • 每 6 小时自动压缩                     │
├─────────────────────────────────────────┤
│         Layer 3: Semantic Memory        │
│         (长期知识)                       │
│  • 抽象化的知识总结                      │
│  • 用户偏好 (USER.md)                   │
│  • Agent 笔记 (MEMORY.md)               │
│  • 自动生成的技能                       │
└─────────────────────────────────────────┘
```

---

## 5. 项目目录结构

```
agent-harness/
├── src/
│   ├── core/                 # 核心引擎
│   │   ├── harness.ts
│   │   ├── loop.ts
│   │   ├── state.ts
│   │   └── events.ts
│   ├── sdk/                  # 插件 SDK
│   │   ├── memory-provider.ts
│   │   ├── tool-provider.ts
│   │   ├── channel-provider.ts
│   │   └── skill-provider.ts
│   ├── plugins/              # 内置插件
│   │   ├── memory/
│   │   │   └── three-tier.ts
│   │   ├── tools/
│   │   │   ├── terminal.ts
│   │   │   ├── file.ts
│   │   │   └── web.ts
│   │   └── channels/
│   │       └── cli.ts
│   ├── state/                # 数据持久化
│   │   ├── session-store.ts
│   │   ├── memory-store.ts
│   │   ├── config-store.ts
│   │   └── skill-store.ts
│   ├── registry/             # 注册表管理
│   │   ├── tool-registry.ts
│   │   └── plugin-loader.ts
│   ├── utils/                # 通用工具
│   └── index.ts              # 入口
├── config/
│   └── agent.yaml.example
├── skills/                   # 技能仓库
├── tests/
├── package.json
└── tsconfig.json
```

---

## 6. 实现优先级

| 模块 | 复杂度 | 优先级 | 参考来源 |
|------|--------|--------|----------|
| Core (Harness + Loop + State) | 高 | P0 | Hermes `run_agent.py` |
| SDK (四个接口) | 中 | P0 | OpenClaw `plugin-sdk` |
| Memory (三层记忆) | 高 | P0 | Hermes `memory_manager.py` |
| Tool Registry | 中 | P0 | Hermes `model_tools.py` |
| CLI Entry | 低 | P0 | Hermes `cli.py` |
| Config System | 低 | P1 | Hermes `cli-config.yaml` |
| Skills System | 中 | P1 | Hermes `skills/` |
| Gateway/Channels | 中 | P2 | OpenClaw `src/channels/` |

---

## 7. 参考源码

本地参考代码位于 `refer/` 目录：

- `refer/hermes-agent/` — Hermes Agent 源码
- `refer/openclaw/` — OpenClaw 源码

引用规范见 `.claude/skills/reference-agent-frameworks.md`。

---

*设计完成日期：2026-06-10*
