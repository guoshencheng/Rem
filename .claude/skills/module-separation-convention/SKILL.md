---
name: module-separation-convention
description: 在 Agent Harness 项目中创建、修改或重构 TypeScript 模块时，遵循模块分离原则。当用户要求新建模块、拆分文件、重构代码、实现功能、添加 provider/插件/sdk 接口，或发现文件过长时，必须使用本 skill。专注于保持文件精简、职责单一、模块独立维护。
---

# 模块分离编码规范

本项目的核心设计哲学是 **Core 最小化 + SDK 稳定 + Plugin 可替换**。所有代码都应遵循模块分离原则，让每个文件、每个目录都承担清晰且单一的职责。

## 何时检查本规范

在以下场景应用本 skill：

- 创建新模块、新功能或新接口
- 重构现有代码
- 发现某个文件超过 200 行（含空行和注释）
- 某个文件混合了多种职责（如既定义接口又实现具体逻辑）
- 添加新的 SDK 接口、Provider、插件或 State 组件
- 用户提到"拆分"、"独立维护"、"文件太大"、"模块分离"

## 核心原则

### 1. 单一职责

每个文件只负责一件事：

- **类型定义** 单独放 `types.ts`
- **接口/抽象** 单独放 `sdk/*.ts`
- **具体实现** 单独放 `plugins/` 或 `defaults/`
- **注册表/工厂** 单独放 `api-registry.ts`、`index.ts`
- **工具函数** 按主题分组，不要塞进业务文件

### 2. 文件大小红线

| 文件类型 | 建议行数 | 绝对上限 |
|---------|---------|---------|
| 类型定义文件 | ≤ 150 行 | 250 行 |
| SDK 接口文件 | ≤ 100 行 | 150 行 |
| 实现文件 | ≤ 150 行 | 200 行 |
| 入口/聚合文件 | ≤ 80 行 | 120 行 |
| 测试文件 | ≤ 250 行 | 350 行 |

超过建议行数时，主动考虑拆分；超过绝对上限时，必须拆分。

### 3. 目录分层

项目采用 Clean Architecture 分层，新代码必须放入正确层级：

```
packages/core/
├── src/
│   ├── core/        # 核心引擎：生命周期、循环、状态、事件
│   ├── sdk/         # 稳定接口：MemoryProvider、ToolProvider、SkillProvider 等
│   ├── plugins/     # 内置实现：具体 Provider、工具、通道
│   ├── state/       # 数据持久化：CRUD，不主动触发逻辑
│   ├── registry/    # 注册表：tool-registry、plugin-loader
│   └── utils/       # 通用工具：与业务无关的纯函数
```

层级依赖方向：**core → sdk → plugins/state/registry → utils**。下层不能依赖上层。

### 4. Provider 模式

参考 `src/llm/` 的 ApiRegistry 模式，每个外部能力都应拆分为：

- `types.ts` — 通用类型与流式聚合器
- `api-registry.ts` — 运行时注册与解析
- `providers/<name>.ts` — 单个 Provider 实现
- `providers/index.ts` — 内置 Provider 注册

## 命名约定

- **文件名**：kebab-case，如 `core-agent.ts`、`tool-provider.ts`、`fixed-budget-policy.ts`
- **类名**：PascalCase，如 `CoreAgent`、`AgentLoop`、`IterationBudget`
- **接口名**：PascalCase，如 `CoreAgentConfig`、`TurnContext`
- **私有方法**：下划线前缀，如 `_getLoop()`、`_getBudgetPolicy()`
- **私有属性**：不使用下划线前缀，使用 `private` 修饰符
- **类型导入**：使用 `import type { X } from './x.js'`，与值导入分开

## 导入/导出约定

1. 使用 `.js` 扩展名（NodeNext 模块解析）
2. `type` 导入放在文件顶部，值导入紧随其后
3. 公共 API 通过 `index.ts` 聚合导出
4. 同一目录内的实现细节不要跨层直接引用

示例：

```typescript
import type { ModelMessage } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import { generateText } from 'ai';
import { AgentLoop } from './loop.js';
```

## 拆分文件时的检查清单

在创建或重构模块前，按顺序确认：

1. [ ] 这个文件是否只承担一种职责？
2. [ ] 文件行数是否在建议范围内？
3. [ ] 类型定义是否抽离到了 `types.ts`？
4. [ ] 抽象接口是否抽离到了 `sdk/`？
5. [ ] 具体实现是否放入 `plugins/` 或 `defaults/`？
6. [ ] 是否通过 `index.ts` 聚合导出？
7. [ ] 新文件的导入是否遵循 type/value 分离、`.js` 扩展名？

## 正例与反例

### 正例：LLM Provider 层

```
src/llm/
├── api-registry.ts     # 仅注册表逻辑（~90 行）
├── types.ts            # 仅类型定义与流式聚合器（~190 行）
└── providers/
    ├── index.ts        # 内置 Provider 注册（~20 行）
    ├── openai.ts       # OpenAI 实现（~130 行）
    └── anthropic.ts    # Anthropic 实现（~140 行）
```

### 反例：大而全的单一文件

```typescript
// ❌ bad: 一个文件里同时有类型、注册表、OpenAI、Anthropic 实现
// src/llm.ts （500+ 行）
```

### 正例：SDK 接口与实现分离

```typescript
// src/sdk/tool-provider.ts — 仅接口
export interface ToolProvider { ... }

// src/defaults/in-memory-tool-provider.ts — 仅默认实现
export class InMemoryToolProvider implements ToolProvider { ... }
```

## 与用户协作的方式

当用户要求实现某个功能时：

1. 先规划模块拆分，告诉用户打算创建哪些文件、每个文件的职责
2. 实现时严格遵守文件大小红线
3. 如果必须超过上限，在代码中说明理由，并提醒用户
4. 完成后简要说明每个新文件/目录的职责

## 常见错误

- 把多个 Provider 写在同一个文件里
- 把接口和默认实现写在同一个文件里
- 在 `core/` 里直接引用 `plugins/` 的具体实现
- 为了"方便"把工具函数塞进业务类
- 用一个大文件处理整个流程，而不是拆成 prepare/reason/execute/observe 等阶段
