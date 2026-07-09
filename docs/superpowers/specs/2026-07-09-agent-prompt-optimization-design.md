# Agent Prompt 优化设计文档

> 日期：2026-07-09  
> 范围：Rem Agent Core 的 system prompt 生成机制  
> 目标：从当前一句 `You are ${agentName}.` 重构为结构化、可扩展、可替换的 system prompt 组装管线。

---

## 1. 背景与问题

### 1.1 当前现状

当前 Rem Agent 的 system prompt 在 `packages/core/src/plugins/memory/simple/index.ts` 中硬编码：

```typescript
systemPrompt: `You are ${this.agentName}.`,
```

在 `run-agent.ts` 中再把 skill catalog 拼接到后面：

```typescript
const skills = await skillProvider.loadSkills();
const catalog = skillProvider.formatCatalog(skills);
if (catalog) systemWithSkills = `${system}\n\n${catalog}`;
```

### 1.2 主要问题

- **内容过于单薄**：没有工具调用风格、执行偏好、安全边界、工作区说明等关键 section。
- **缺乏项目上下文注入**：没有读取 `AGENTS.md` / `CLAUDE.md` 等项目级指令。
- **不可扩展**：所有内容写死在 `SimpleContextProvider` 中，未来替换困难。
- **无多 Agent / 多 Provider 支持**：无法为不同 Agent 或不同模型定制 prompt。

### 1.3 参考调研结论

- **OpenClaw**：采用分层 section 组装 + cache boundary + provider override + prompt mode（full/minimal/none）。优点是结构清晰、功能完整；缺点是 section 过多、部分内容与 Rem 当前场景不完全匹配。
- **OpenCode**：采用 provider 模板文件 + 动态 environment / skills / AGENTS.md 拼接。优点是简洁、按模型优化、模板可维护；缺点是局部替换不如 section builder 灵活。

本设计取两家之长：**以 OpenCode 的简洁风格为主，吸收 OpenClaw 的清晰 section 分层**，为 Rem Agent 构建一个可扩展的 system prompt 组装管线。

---

## 2. 设计目标

1. **结构化**：把 system prompt 拆分为职责单一的 section。
2. **可注入**：项目中内置一个默认 prompt 模板，作为 Identity section 注入。
3. **可替换**：未来可以整体或局部替换模板/section，不修改 core 代码。
4. **项目上下文**：自动读取工作区根目录的 `AGENTS.md` 并注入。
5. **多 Agent 预留**：接口上预留按 Agent 名定制的能力，MVP 阶段只实现默认 Agent。
6. **Provider 模板**：MVP 阶段实现 Claude 默认模板 + GPT 专用模板；Claude 模板作为无法识别模型时的默认兜底。

---

## 3. 核心抽象

### 3.1 接口定义

```typescript
// packages/core/src/sdk/system-prompt.ts

export interface PromptBuildContext {
  agentName: string;
  workspaceRoot: string;
  readOnly: boolean;
  tools: ToolInfo[];
  skills: Skill[];
  model: { provider: string; model: string };
  runtime: {
    platform: string;
    nodeVersion: string;
    today: string;
    cwd: string;
  };
}

export interface AgentPromptTemplate {
  readonly name: string;
  render(ctx: PromptBuildContext): string | Promise<string>;
}

export interface PromptSection {
  readonly name: string;
  render(ctx: PromptBuildContext): string | undefined | Promise<string | undefined>;
}

export interface SystemPromptAssembler {
  assemble(ctx: PromptBuildContext): Promise<string>;
}
```

### 3.2 默认 Assembler 实现

```typescript
// packages/core/src/system-prompt/assembler.ts
export class DefaultSystemPromptAssembler implements SystemPromptAssembler {
  constructor(
    private templateSelector: AgentPromptTemplateSelector,
    private sections: PromptSection[],
  ) {}

  async assemble(ctx: PromptBuildContext): Promise<string> {
    const template = this.templateSelector.select(ctx);
    const parts: string[] = [await template.render(ctx)];
    for (const section of this.sections) {
      const content = await section.render(ctx);
      if (content) parts.push(content);
    }
    return parts.filter(Boolean).join('\n\n');
  }
}
```

### 3.3 默认模板与模板选择

MVP 阶段内置两个模板文件：

| 模板 | 文件 | 用途 |
|---|---|---|
| Claude 默认模板 | `packages/core/src/system-prompt/claude-template.md` | 默认兜底；Claude 系列模型使用 |
| GPT 专用模板 | `packages/core/src/system-prompt/openai-template.md` | OpenAI GPT 系列模型使用 |

模板选择逻辑：

```typescript
// packages/core/src/system-prompt/template-selector.ts
export interface AgentPromptTemplateSelector {
  select(ctx: PromptBuildContext): AgentPromptTemplate;
}

export class ProviderAwareTemplateSelector implements AgentPromptTemplateSelector {
  constructor(
    private defaultTemplate: AgentPromptTemplate,
    private providerTemplates: Record<string, AgentPromptTemplate>,
  ) {}

  select(ctx: PromptBuildContext): AgentPromptTemplate {
    const key = `${ctx.model.provider}/${ctx.model.model}`.toLowerCase();
    if (key.includes('openai') || key.includes('gpt')) {
      return this.providerTemplates['openai'] ?? this.defaultTemplate;
    }
    return this.defaultTemplate;
  }
}
```

`AgentContextBuilder` 中使用选择器：

```typescript
const templateSelector = new ProviderAwareTemplateSelector(
  new ClaudeAgentPromptTemplate(),
  { openai: new OpenAiAgentPromptTemplate() },
);
```

模板内容只负责 Agent 身份、tone、顶层规则，不掺和其他 section。

---

## 4. Prompt Section 清单

MVP 阶段设计 8 个 section，按以下顺序拼接：

| 顺序 | Section | 职责 | 是否条件性 |
|---|---|---|---|
| 1 | Identity | Agent 身份、tone、核心规则（来自默认模板） | 否 |
| 2 | Tooling | 列出可用工具及调用规范 | 是（无工具时跳过） |
| 3 | Execution Bias | 执行偏好：立即行动、弱结果重试、最终回答需证据 | 否 |
| 4 | Safety | 安全边界：无独立目标、配置修改前检查 | 否 |
| 5 | Workspace | 工作目录、只读状态 | 是（无 workspace 时跳过） |
| 6 | AGENTS.md | 注入项目级指令 | 是（文件不存在时跳过） |
| 7 | Skills | 可用 skills 列表与使用指引 | 是（无 skills 时跳过） |
| 8 | Runtime | 模型、provider、平台、日期 | 否 |

### 4.1 Identity Section

由 `AgentPromptTemplate.render()` 提供。根据模型选择不同模板。

#### Claude 默认模板（兜底）

```markdown
You are {{agentName}}, a general-purpose assistant running inside Rem Agent, powered by Claude.

You help users with software engineering and daily tasks by using the tools available to you.

# Tone and style
- Be concise, direct, and technically accurate.
- Prioritize truthfulness over validating the user's beliefs; disagree respectfully when necessary.
- Your output is displayed in a terminal/chat UI. Use GitHub-flavored markdown for formatting.
- Only use tools to complete tasks; do not use code comments or shell output as a substitute for user communication.
- Avoid emojis unless the user explicitly asks for them.

# Code conventions
- When referencing specific code, use `file_path:line_number`.
- Do not add comments unless asked.
- Do not create files unless absolutely necessary; prefer editing existing files.
- Follow existing code conventions in the project.

# Tool usage
- Use specialized tools instead of bash commands when a first-class tool exists.
- You can call multiple tools in parallel when they are independent.
- If a tool result is weak or empty, vary your query/path/command before giving up.
```

#### GPT 专用模板

```markdown
You are {{agentName}}, a general-purpose assistant running inside Rem Agent, powered by an OpenAI model.

You help users with software engineering and daily tasks by using the tools available to you.

# Tone and style
- Be concise, direct, and to the point. Minimize output tokens while maintaining helpfulness and accuracy.
- Prioritize truthfulness over validating the user's beliefs.
- Your output is displayed in a terminal/chat UI. Use GitHub-flavored markdown for formatting.
- Only use tools to complete tasks; do not use code comments or shell output as a substitute for user communication.

# Code conventions
- When referencing specific code, use `file_path:line_number`.
- Do not add comments unless asked.
- Do not create files unless absolutely necessary; prefer editing existing files.
- Follow existing code conventions in the project.

# Tool usage
- Use specialized tools instead of bash commands when a first-class tool exists.
- Call multiple tools in parallel when they are independent.
- If a tool result is weak or empty, vary your query/path/command before giving up.
```

> 注：两个模板的差异主要在 tone 和模型身份声明；section 级内容（Tooling、Execution Bias 等）共享。

### 4.2 Tooling Section

```text
## Tooling

You have access to the following tools. Names are case-sensitive; call exactly as listed.

- read: Read file contents
- write: Create or overwrite files
- edit: Make precise edits to files
- exec: Run shell commands
- ...
```

### 4.3 Execution Bias Section

```text
## Execution Bias

- Actionable request: act in this turn.
- Continue until done or genuinely blocked; do not finish with a plan when tools can move forward.
- Weak/empty tool result: vary query, path, command, or source before concluding.
- Mutable facts need live checks: files, git, clocks, versions, services.
- Final answer needs evidence: test/build/lint output, inspection, or a named blocker.
```

### 4.4 Safety Section

```text
## Safety

- No independent goals: no self-preservation, replication, resource acquisition, or power-seeking.
- Safety/oversight over completion. Conflicts: pause and ask.
- Before changing config or schedulers, inspect existing state first and preserve by default.
- Do not persuade anyone to expand access or disable safeguards.
```

### 4.5 Workspace Section

```text
## Workspace

Working directory: /Users/guoshencheng/Documents/work/rem
Read-only mode: false
```

### 4.6 AGENTS.md Section

通过 `AgentInstructionLoader` 抽象读取项目级指令：

```typescript
export interface AgentInstructionLoader {
  load(workspaceRoot: string, agentName: string): Promise<string | undefined>;
}
```

MVP 实现只读 `workspaceRoot/AGENTS.md`：

```typescript
export class ProjectAgentsMdLoader implements AgentInstructionLoader {
  async load(workspaceRoot: string, _agentName: string): Promise<string | undefined> {
    const filePath = join(workspaceRoot, 'AGENTS.md');
    const content = await readFile(filePath, 'utf-8').catch(() => undefined);
    return content?.trim() || undefined;
  }
}
```

注入格式：

```text
## Project Instructions

{AGENTS.md raw content}
```

未来要支持 `<agent-name>.agent.md` 时，只需新增一个 `AgentInstructionLoader` 实现（如 `NamedAgentInstructionLoader`），`AgentsMdSection` 本身无需修改。

### 4.7 Skills Section

复用现有 `skillProvider.formatCatalog()`，输出保持现有 XML 格式：

```text
The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the `read_skill` tool ...

<available_skills>
  <skill>
    <name>...</name>
    <description>...</description>
    <location>...</location>
  </skill>
</available_skills>
```

### 4.8 Runtime Section

```text
## Runtime

Agent: Rem | Provider: openai | Model: gpt-4o | Platform: darwin | Node: v20.x | Date: 2026-07-09
```

---

## 5. 数据流与集成

### 5.1 改造前

```text
run-agent.ts
  └─> ctx.contextProvider.build(session, name)
        └─> SimpleContextProvider.buildContext()
              └─> systemPrompt = `You are ${name}.`
  └─> skillProvider.loadSkills() + formatCatalog()
  └─> systemWithSkills = `${system}\n\n${catalog}`
  └─> loopCtx.system = systemWithSkills
```

### 5.2 改造后

```text
run-agent.ts
  ├─> effectiveToolProvider = compose tools + mcp + skill-read
  ├─> buildCtx = {
  │       agentName, workspaceRoot, readOnly,
  │       tools, skills, model, runtime
  │     }
  ├─> ctx.systemPromptAssembler.assemble(buildCtx)
  │     ├─> templateSelector.select(ctx)              → 选择 Claude / GPT 模板
  │     ├─> AgentPromptTemplate.render()             → Identity
  │     ├─> ToolingSection.render()                  → Tooling
  │     ├─> ExecutionBiasSection.render()            → Execution Bias
  │     ├─> SafetySection.render()                   → Safety
  │     ├─> WorkspaceSection.render()                → Workspace
  │     ├─> AgentsMdSection.render()                 → AGENTS.md
  │     ├─> SkillsSection.render()                   → Skills
  │     └─> RuntimeSection.render()                  → Runtime
  │     └─> join('\n\n')
  └─> loopCtx.system = assembledSystemPrompt
```

### 5.3 AgentContext 变更

```typescript
export interface AgentContext {
  // ... 现有字段
  systemPromptAssembler: SystemPromptAssembler; // 新增
}
```

`AgentContextBuilder` 中创建：

```typescript
const templateSelector = new ProviderAwareTemplateSelector(
  new ClaudeAgentPromptTemplate(),
  { openai: new OpenAiAgentPromptTemplate() },
);

const systemPromptAssembler = new DefaultSystemPromptAssembler(
  templateSelector,
  [
    new ToolingSection(),
    new ExecutionBiasSection(),
    new SafetySection(),
    new WorkspaceSection(),
    new AgentsMdSection(new ProjectAgentsMdLoader()),
    new SkillsSection(skillProvider),
    new RuntimeSection(),
  ],
);
```

### 5.4 SimpleContextProvider 简化

`SimpleContextProvider` 不再生成 system prompt，只返回 messages。MVP 阶段保留 `system` 字段但留空，作为过渡：

```typescript
async build(session: Session, _agentName: string): Promise<{ system: string; messages: ModelMessage[] }> {
  return {
    system: '',
    messages: session.conversation,
  };
}
```

未来可以彻底移除 `ContextProvider` 接口中的 `system` 字段。

---

## 6. 错误处理与边界情况

| 场景 | 处理策略 |
|---|---|
| `AGENTS.md` 不存在 | section 返回 `undefined`，不报错 |
| `AGENTS.md` 为空/只有空白 | 返回 `undefined` |
| `AGENTS.md` 读取失败 | 记录 debug log，返回 `undefined`，不阻断主流程 |
| skills 加载失败 | 返回 `undefined`，不阻断 |
| 工具列表为空 | `ToolingSection` 返回 `undefined` |
| `workspaceRoot` 为空 | `WorkspaceSection` 返回 `undefined` |
| 默认模板渲染失败 | 抛出错误，因为这是核心身份模板 |

**原则**：每个 section 自己的错误自己吞掉，返回 `undefined`；assembler 不因为某个 section 失败而中断。

---

## 7. 测试策略

### 7.1 Section 单元测试

每个 section 单独测试，输入 `PromptBuildContext`，验证输出包含预期内容。

### 7.2 Assembler 集成测试

验证 section 过滤、顺序、拼接分隔符：

```typescript
it('joins non-empty sections with double newline', async () => {
  const assembler = new DefaultSystemPromptAssembler(
    { name: 'test', render: () => 'Identity' },
    [
      { name: 'a', render: () => 'Section A' },
      { name: 'b', render: () => undefined },
      { name: 'c', render: () => 'Section C' },
    ],
  );
  const result = await assembler.assemble({} as PromptBuildContext);
  expect(result).toBe('Identity\n\nSection A\n\nSection C');
});
```

### 7.3 快照测试

对完整 system prompt 生成结果做快照，便于回归时发现 unintended changes。

### 7.4 AGENTS.md 集成测试

在临时目录创建 `AGENTS.md`，验证 system prompt 中包含其内容。

### 7.5 不测试的内容

- 不测试具体模型行为。
- 不测试未支持的 provider（如 Gemini、MiniMax）的模板路由。

---

## 8. 不在 MVP 范围内

以下特性作为后续扩展，MVP 阶段不实现，但接口上预留空间：

| 特性 | 预留方式 |
|---|---|
| Cache boundary | `SystemPromptAssembler` 未来可拆分为 stable/dynamic 两部分 |
| 更多 Provider 模板（Gemini / MiniMax / Trinity 等） | `ProviderAwareTemplateSelector` 可扩展 |
| 按 Agent 名定制 | `AgentInstructionLoader` 接口可替换为 `NamedAgentInstructionLoader` |
| Prompt mode（full/minimal） | 未来可通过 `AgentPromptProfile` 选择不同 section 组合 |
| 动态上下文文件（如 heartbeat.md） | 未来可作为 dynamic section 注入 |

---

## 9. 影响范围

- 新增文件：
  - `packages/core/src/sdk/system-prompt.ts`
  - `packages/core/src/system-prompt/assembler.ts`
  - `packages/core/src/system-prompt/template-selector.ts`
  - `packages/core/src/system-prompt/claude-template.md`
  - `packages/core/src/system-prompt/claude-template.ts`
  - `packages/core/src/system-prompt/openai-template.md`
  - `packages/core/src/system-prompt/openai-template.ts`
  - `packages/core/src/system-prompt/sections/*.ts`
  - `packages/core/src/system-prompt/loaders/*.ts`
  - 对应测试文件

- 修改文件：
  - `packages/core/src/agent-context.ts`：新增 `systemPromptAssembler` 字段
  - `packages/core/src/agent-context-builder.ts`：创建 assembler
  - `packages/core/src/run-agent.ts`：构造 `PromptBuildContext` 并调用 assembler
  - `packages/core/src/plugins/memory/simple/index.ts`：`system` 字段留空

---

## 10. 决策记录

1. **默认模板使用 Markdown 文件而非 TS 字符串常量**：便于阅读和维护，构建时内联读取。
2. **Section 通过类实现而非纯函数**：便于未来注入依赖（如 `SkillsSection` 依赖 `SkillProvider`）。
3. **AGENTS.md 读取抽象为 `AgentInstructionLoader`**：为将来 `<agent-name>.agent.md` 留下扩展点。
4. **MVP 不做 cache boundary**：先把内容做对，缓存优化作为第二阶段。
5. **MVP 提供 Claude 默认模板 + GPT 专用模板**：Claude 模板作为无法识别模型时的默认兜底；通过 `ProviderAwareTemplateSelector` 按 provider/model 路由。
