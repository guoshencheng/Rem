# REM 自定义 Agent 配置设计

> 状态：已实现  
> 日期：2026-07-13  
> 方案：方案 A（扩展 ConfigProvider + AgentResolver + SystemPromptAssembler）

---

## 1. 目标

让 REM 支持在配置文件中预定义多个自定义 agent 角色。每个角色可以指定：

- 显示名称（用于替换 system prompt 中的 `{{agentName}}`）。
- 核心提示词（用于替换 system prompt 中的 `{{agentRolePrompt}}`）。
- 可选的优先模型（覆盖当前运行使用的模型）。

运行时通过 `runAgent({ ..., agent: 'coder' })` 按名称切换角色，未指定或不存在时 fallback 到内置 default agent。

---

## 2. 关键决策

| 决策 | 选择 | 原因 |
|---|---|---|
| 配置形式 | `agents` 对象映射 | key 即 id，简洁直观。 |
| 必填字段 | `name` + `corePrompt` | 标识身份与角色定义是 agent 的核心。 |
| 模型覆盖 | 可选 `model` | 未写时使用顶层默认模型，保持简单。 |
| 其他行为配置 | 不允许覆盖 | 保持 agent 切换只影响 system prompt 和模型。 |
| 传入方式 | 只在 `RunAgentParams` 中传 `agent?: string` | `AgentContext` 保持复用，单次运行切换角色。 |
| 与 system prompt 结合 | 模板变量 `{{agentName}}` + `{{agentRolePrompt}}` | 保留通用章节，只替换身份与角色相关部分。 |
| corePrompt 模板变量 | 不支持 | 保持配置简单，避免意外复杂度。 |
| 未命中处理 | fallback 到内置 default agent | 向后兼容，运行稳定。 |

---

## 3. 配置 Schema 与核心类型

在 `packages/core/src/sdk/config-provider.ts` 中扩展：

```typescript
export interface CustomAgentConfig {
  name: string;                    // 必填，用于替换 {{agentName}}
  corePrompt: string;              // 必填，用于替换 {{agentRolePrompt}}
  model?: AgentModelConfig;        // 可选，覆盖当前模型
}

export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  // ... 已有字段 ...
  agents?: Record<string, CustomAgentConfig>;
}
```

新增解析后类型：

```typescript
export interface ResolvedAgentRole {
  id: string;                      // agent key
  name: string;                    // 解析后的显示名称
  corePrompt: string;              // 解析后的核心提示词
  model?: ResolvedModelConfig;     // 解析后的模型，未指定则 undefined
}
```

配置文件示例：

```json
{
  "name": "Rem Agent",
  "model": { "provider": "openai", "model": "gpt-4o-mini" },
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "corePrompt": "You focus on writing, reviewing, and refactoring code. Prefer concise solutions and follow the existing code style.",
      "model": { "provider": "openai", "model": "gpt-4o" }
    },
    "reviewer": {
      "name": "Code Reviewer",
      "corePrompt": "You are a strict code reviewer. Look for bugs, security issues, and maintainability problems."
    }
  }
}
```

`ConfigProvider` 新增方法：

```typescript
interface ConfigProvider {
  // ... 已有方法 ...
  resolveAgent(id?: string): ResolvedAgentRole;
}
```

---

## 4. Default Agent 与解析规则

新增独立模块 `packages/core/src/agent-resolver.ts`，职责单一：把配置中的原始 `agents` 映射 + 内置 default 合并成可查询的角色表。

内置 default agent：

```typescript
const DEFAULT_AGENT_ID = 'default';

const BUILTIN_DEFAULT_AGENT: ResolvedAgentRole = {
  id: DEFAULT_AGENT_ID,
  name: behaviorConfig.name, // 如 'Rem Agent'
  corePrompt: `You help users with software engineering and daily tasks by using the tools available to you.`,
  model: undefined,          // 不覆盖，使用顶层 model
};
```

解析规则：

1. 如果 `agents.default` 存在，用用户定义覆盖内置 default 的 `name` / `corePrompt` / `model`（`id` 保持 `'default'`）。
2. 用户自定义 agent 必须含 `name` 和 `corePrompt`；缺失任一项时，该 agent 视为无效，fallback 到 default。
3. `resolveAgent(id?)`：
   - 未传 `id` → default。
   - 传了 id 且存在有效自定义 agent → 该 agent。
   - 传了 id 但不存在或无效 → default（记录 warning 日志）。

模块边界：

- `AgentResolver` 只读配置，不读环境变量，不访问文件系统。
- 由 `DefaultConfigProvider` 在 `init()` 后实例化并持有。
- `ConfigProvider.resolveAgent` 委托给它。

---

## 5. System Prompt 模板改造

改造后模板结构：

```markdown
You are {{agentName}}, an agent running inside Rem Agent.

{{agentRolePrompt}}

# Tone and style
...
# Code conventions
...
# Tool usage
...
```

- 模板保留 `You are {{agentName}}, ...` 作为固定身份句。
- `{{agentRolePrompt}}` 紧接其后，插入 agent 的核心提示词。
- 用户写 `corePrompt` 时只写具体角色说明，例如：
  - default：`You help users with software engineering and daily tasks by using the tools available to you.`
  - coder：`You focus on writing, reviewing, and refactoring code. Prefer concise solutions and follow the existing code style.`

`PromptBuildContext` 扩展：

```typescript
export interface PromptBuildContext {
  // ... 已有字段 ...
  agentName: string;
  agentCorePrompt: string;
}
```

渲染逻辑：

1. 替换 `{{agentRolePrompt}}` → `agentCorePrompt`。
2. 替换 `{{agentName}}` → `agentName`。

这样 `corePrompt` 保持纯文本，用户无需关心 `{{agentName}}`。

---

## 6. `runAgent` 运行时集成

`RunAgentParams` 扩展：

```typescript
export interface RunAgentParams {
  // ... 已有字段 ...
  agent?: string; // 自定义 agent 的 id
}
```

`runAgent` 内部改动：

1. 在读取 `behavior` 和 `modelConfig` 之后：

```typescript
const agentRole = ctx.configProvider.resolveAgent(params.agent);

// 如果 agent 指定了模型，覆盖 modelConfig
const effectiveModel = agentRole.model ?? modelConfig;
```

2. 构造 `PromptBuildContext` 时：

```typescript
const buildCtx: PromptBuildContext = {
  // ... 已有字段 ...
  agentName: agentRole.name,
  agentCorePrompt: agentRole.corePrompt,
};
```

3. 后续 `reason()` 调用使用 `effectiveModel` 和渲染后的 `systemPrompt`。

保持其他行为配置不变：

- `maxTurns`、`readOnly`、`workspaceRoot` 等仍来自顶层 `behavior`。
- 工具集、MCP、skill、安全规则完全复用父 `AgentContext`。

`AgentService` / `AgentRemoteService` 等调用方可以后续扩展透传 `agent` 参数；若暂不扩展，则默认使用 `default` agent，不影响现有行为。

---

## 7. 模块拆分与文件清单

遵循 `module-separation-convention`，保持文件精简。

**新建文件：**

| 文件 | 职责 |
|---|---|
| `packages/core/src/sdk/agent-role.ts` | 定义 `CustomAgentConfig`、`ResolvedAgentRole` 类型；定义 `AgentResolver` 接口。 |
| `packages/core/src/agent-resolver.ts` | `AgentResolver` 实现：合并内置 default、解析自定义 agents、处理 fallback。 |
| `packages/core/src/system-prompt/variables/agent-role-variables.ts` | 封装 `{{agentName}}` / `{{agentRolePrompt}}` 替换逻辑。 |

**修改文件：**

| 文件 | 改动 |
|---|---|
| `packages/core/src/sdk/config-provider.ts` | `AgentConfig` 增加 `agents` 字段；`ConfigProvider` 增加 `resolveAgent` 方法。 |
| `packages/core/src/sdk/system-prompt.ts` | `PromptBuildContext` 增加 `agentName`、`agentCorePrompt`。 |
| `packages/core/src/plugins/config/default/index.ts` | `DefaultConfigProvider` 初始化 `AgentResolver`；实现 `resolveAgent`。 |
| `packages/core/src/plugins/config/default/config-parser.ts` | 新增 `pickAgents` / `pickCustomAgentConfig` 解析函数。 |
| `packages/core/src/plugins/config/default/config-merger.ts` | 合并 `agents` 配置。 |
| `packages/core/src/system-prompt/templates/claude-template.md` | 调整结构，分离 `{{agentName}}` 固定句与 `{{agentRolePrompt}}`。 |
| `packages/core/src/system-prompt/templates/claude-template.ts` | 渲染时替换新变量。 |
| `packages/core/src/system-prompt/templates/openai-template.ts` 及 `.md` | 同步调整。 |
| `packages/core/src/run-agent.ts` | `RunAgentParams` 增加 `agent`；运行时解析并覆盖模型与 system prompt。 |
| `packages/bridge/src/agent.ts` | 可选：`AgentService.run` 透传 `agent` 参数。 |

**文件边界：**

- `agent-resolver.ts` 不依赖 system prompt 模板，只产出 `ResolvedAgentRole`。
- system prompt 模板只负责渲染变量，不知道 agent 来源。
- `runAgent` 负责把 resolver 结果应用到单次运行。

---

## 8. 数据流

**阶段 1：初始化 / 配置加载**

```
rem-agent.config.json
       │
       ▼
DefaultConfigProvider.init()
       │
       ├── 加载 home / workspace / overrides / env
       ├── 解析 agents（通过 config-parser / config-merger）
       ├── 用 behavior.name + 模板身份段构建内置 default agent
       └── 实例化 AgentResolver
                │
                ▼
        resolveAgent(id?) → ResolvedAgentRole
```

**阶段 2：单次运行**

```
runAgent({ input, sessionId, agent: 'coder', ctx, ... })
       │
       ▼
ctx.configProvider.resolveAgent('coder')
       │
       ├── 命中有效 'coder' → { id:'coder', name:'Code Assistant',
       │                       corePrompt:'...', model:{...} }
       │
       └── 未命中 / 无效 → default
       │
       ▼
effectiveModel = agentRole.model ?? ctx.configProvider.getModelConfig()
       │
       ▼
ctx.contextProvider.build(session, behavior.name)
       │
       ▼
ctx.systemPromptAssembler.assemble({
       ...buildCtx,
       agentName: agentRole.name,
       agentCorePrompt: agentRole.corePrompt,
     })
       │
       ▼
template.render() 替换 {{agentName}} 和 {{agentRolePrompt}}
       │
       ▼
loopStrategy.run({ ..., system: renderedPrompt, reason with effectiveModel })
```

**不变的数据：**

- `sessionProvider` 会话、工具集、MCP、skill、安全规则、`maxTurns`、workspaceRoot 等全部复用同一 `AgentContext`，不随 agent 切换而改变。

---

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| `agents` 配置未提供 | `resolveAgent()` 始终返回 default。 |
| 自定义 agent 缺少 `name` 或 `corePrompt` | 视为无效，fallback 到 default，并记录 `log('config', 'invalid agent config', { id })`。 |
| 自定义 agent `model` 缺少 `provider` 或 `model` | 忽略该 `model` 覆盖，fallback 到顶层模型，并记录 warning。 |
| 运行时传入不存在的 agent id | fallback 到 default，记录 `log('run-agent', 'unknown agent', { id })`。 |
| 运行时未传 `agent` | 直接返回 default，无日志。 |

**安全与边界：**

- `corePrompt` 不解析模板变量，防止用户配置意外读取环境或运行时信息。
- `agent` 参数只影响本次 `runAgent` 调用的 system prompt 和模型，不改变 `AgentContext` 状态，也不影响其他并发运行。

---

## 10. 测试策略

**单元测试：**

| 测试目标 | 覆盖点 |
|---|---|
| `AgentResolver` | default 内置生效；自定义 agent 命中；无效 agent fallback；未传 id fallback；name/corePrompt 必填。 |
| `config-parser` / `config-merger` | 正确解析 `agents` 映射；home 与 workspace 配置深度合并。 |
| `agent-role-variables` | `{{agentName}}`、`{{agentRolePrompt}}` 正确替换；缺失变量保持原样。 |
| 模板渲染 | default agent corePrompt 出现在 system prompt 中；自定义 agent 覆盖后内容正确。 |

**集成测试：**

| 测试目标 | 覆盖点 |
|---|---|
| `runAgent` 传入 `agent` | 使用自定义 agent 的 `corePrompt` 和模型；未传时使用 default。 |
| model 覆盖 | agent 指定 model 时，`reason()` 调用使用指定 provider/model；未指定时使用顶层模型。 |
| 无效 agent | 传入不存在的 agent id 时仍正常完成，使用 default。 |

**端到端测试：**

- 准备一个带 `agents` 的 `rem-agent.config.json`，启动 `AgentService`，验证运行指定 agent 时 system prompt 与模型符合预期。

---

## 11. 未来扩展点

当前设计最小可用，后续可扩展：

- **按 workspace 定义 agent**：允许在项目级配置中覆盖 home 级 default agent。
- **热重载**：监听配置文件变化，重新解析 agent 映射。
- **CLI / Web 选择器**：在 UI 中展示可用 agent 列表，让用户手动切换。
- **调用方透传**：`AgentService.run` 和 bridge API 支持前端选择 agent 后下发到 core。

---

## 12. 文件清单

### 新建

- `packages/core/src/sdk/agent-role.ts`
- `packages/core/src/agent-resolver.ts`
- `packages/core/src/system-prompt/variables/agent-role-variables.ts`

### 修改

- `packages/core/src/sdk/config-provider.ts`
- `packages/core/src/sdk/system-prompt.ts`
- `packages/core/src/plugins/config/default/index.ts`
- `packages/core/src/plugins/config/default/config-parser.ts`
- `packages/core/src/plugins/config/default/config-merger.ts`
- `packages/core/src/system-prompt/templates/claude-template.md`
- `packages/core/src/system-prompt/templates/claude-template.ts`
- `packages/core/src/system-prompt/templates/openai-template.md`
- `packages/core/src/system-prompt/templates/openai-template.ts`
- `packages/core/src/run-agent.ts`
- `packages/bridge/src/agent.ts`（可选透传）

---

*设计完成，等待进入实现计划。*
