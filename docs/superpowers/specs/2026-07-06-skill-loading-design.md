# Skill 加载与按需读取工具设计

> 日期：2026-07-06  
> 范围：rem-agent-core  
> 状态：待实现

---

## 1. 背景与目标

### 1.1 当前状态

`packages/core` 已经具备基础的 Skill 系统：

- `SkillProvider` 接口定义在 `packages/core/src/sdk/skill-provider.ts`。
- `FileSkillProvider` 扫描 `skillsDir` 下的每个子目录，读取其中的 `SKILL.md`。
- `ReactLoop.enrichSystemPrompt()` 在每轮推理前调用 `SkillProvider.loadSkills()` 与 `formatCatalog()`，把技能目录拼进 system prompt。

**当前缺口**：

- system prompt 中只告诉 AI 有哪些技能，没有明确指导它何时、如何加载并执行技能。
- AI 没有工具可以读取某个技能的完整 `SKILL.md` 内容，只能依赖 system prompt 中极短的描述。
- 长技能内容无法全部塞进 system prompt，必须支持按需读取。

### 1.2 设计目标

1. 启动时继续由 `SkillProvider` 加载所有技能的名称、描述和位置，追加到 system prompt。
2. 在 system prompt 中增加引导语，让 AI 知道何时应调用工具读取技能详情。
3. 新增一个 Core 内置工具 `read_skill`，支持 AI 按需读取某个技能的完整 `SKILL.md` 原文。
4. 读取逻辑保留在 `SkillProvider` 实现中，Core 只负责暴露工具入口。

---

## 2. 总体设计

### 2.1 设计原则

- **SkillProvider 保持核心地位**：扫描、格式化、读取都走 `SkillProvider`，不绕到 Core 的文件系统。
- **Core 仅注入工具**：`ProviderManager` 在初始化完成后，向当前 `ToolProvider` 注册内置的 `read_skill` 工具。
- **默认行为零配置**：用户无需手动配置即可获得 `read_skill` 工具。
- **不改变现有接口的默认行为**：`loadSkills()` 和 `formatCatalog()` 保持原语义。

### 2.2 架构关系

```
┌─────────────────────────────────────┐
│          ReactLoop.iterate          │
│  enrichSystemPrompt()               │
│    → SkillProvider.loadSkills()     │
│    → SkillProvider.formatCatalog()  │
│    → 追加引导语 + <available_skills> │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│        ProviderManager.init()       │
│  registry.initialize() 之后         │
│  向 ToolProvider 注册 read_skill     │
│    → SkillProvider.readSkillRaw()   │
└─────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│          ToolProvider               │
│  执行 read_skill({ name })          │
│    → 返回 SKILL.md 原始文本         │
└─────────────────────────────────────┘
```

---

## 3. 接口变更

### 3.1 `SkillProvider` 新增 `readSkillRaw`

文件：`packages/core/src/sdk/skill-provider.ts`

```typescript
export interface SkillProvider {
  loadSkills(): Promise<Skill[]>;
  formatCatalog(skills: Skill[]): string;
  readSkillRaw(name: string): Promise<string | undefined>;
}
```

- `name`：技能名称，对应 `Skill.name`。
- 返回值：
  - 找到：返回 `SKILL.md` 的完整原始文本，含 YAML frontmatter。
  - 未找到：返回 `undefined`。
- 读取失败：抛出异常，由工具执行层捕获并转换为 `ToolResult.error`。

### 3.2 `FileSkillProvider` 实现 `readSkillRaw`

文件：`packages/core/src/plugins/skill/file/index.ts`

实现逻辑：

```typescript
async readSkillRaw(name: string): Promise<string | undefined> {
  if (this.skillsDir === '') return undefined;

  const skillDir = join(this.skillsDir, name);
  const skillFile = join(skillDir, 'SKILL.md');

  try {
    const entryStat = await stat(skillDir);
    if (!entryStat.isDirectory()) return undefined;
  } catch {
    return undefined;
  }

  try {
    return await readFile(skillFile, 'utf-8');
  } catch {
    return undefined;
  }
}
```

- 直接读取 `skillsDir/<name>/SKILL.md`。
- 不调用 `parseSkillMarkdown`，保持原始文本返回。

---

## 4. System Prompt 引导语

### 4.1 引导语内容

追加在 `<available_skills>` 之前：

```text
The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the `read_skill` tool with the skill name
to load its full SKILL.md. Then follow the instructions inside the skill; if the skill
references additional files or commands, use the appropriate tools to gather more
information or execute actions.
```

### 4.2 拼接位置

保留现有 `DefaultSkillCatalog.format()` 的输出结构，把引导语插入到目录列表之前：

```text
<引导语>

<available_skills>
  <skill>...</skill>
</available_skills>
```

### 4.3 实现位置

修改 `packages/core/src/plugins/skill/default-catalog.ts`：

- `DefaultSkillCatalog.format(skills)` 在 `skills.length === 0` 时返回空字符串。
- 有技能时，返回引导语 + `<available_skills>` 块。

---

## 5. 内置工具 `read_skill`

### 5.1 工具定义

- **名称**：`read_skill`
- **描述**：Load the full SKILL.md content for a named skill so its specialized instructions can be followed.
- **参数**：
  - `name`：`string`，required，技能名称。

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Name of the skill to load" }
  },
  "required": ["name"]
}
```

### 5.2 工具执行

- 通过 `ProviderManager.require<SkillProvider>('skill')` 获取 provider。
- 调用 `readSkillRaw(name)`。
- 返回 `ToolResult`：
  - 命中：`{ output: rawMarkdown }`
  - 未找到：`{ error: 'Skill "<name>" not found' }`
  - 读取异常：`{ error: error.message }`

### 5.3 注册时机

在 `ProviderManager.init()` 中：

```typescript
await registry.initialize();
this.registerSkillReadTool();
this.registry = registry;
this.initialized = true;
```

`registerSkillReadTool()` 实现要点：

- 获取 `ToolProvider`：`this.registry.require<ToolProvider>('tool')`。
- 检查 `ToolProvider` 是否支持动态注册（具备 `registerTool` 方法）。
- 注册 `read_skill` 工具，执行时访问当前 `SkillProvider`。
- 如果 `ToolProvider` 不支持动态注册，记录 debug 日志并跳过，不阻塞初始化。

### 5.4 工具执行时的依赖访问

工具执行函数内部通过闭包或 `ProviderManager` 引用访问 `SkillProvider`，而不是在创建工具时硬编码实例。这样可以保证：

- 工具始终使用当前注册的 `SkillProvider`。
- 如果未来 `SkillProvider` 被替换，工具行为自动跟随。

---

## 6. 与现有组件的交互

### 6.1 `ReactLoop`

`enrichSystemPrompt()` 保持不变：

```typescript
private async enrichSystemPrompt(basePrompt: string): Promise<string> {
  if (!this.skillProvider) return basePrompt;
  const skills = await this.skillProvider.loadSkills();
  const catalog = this.skillProvider.formatCatalog(skills);
  if (!catalog) return basePrompt;
  return `${basePrompt}\n\n${catalog}`;
}
```

引导语通过 `DefaultSkillCatalog.format()` 自动包含在 `catalog` 中。

### 6.2 `ProviderManager`

新增私有方法 `registerSkillReadTool()`，在 `init()` 中调用。

### 6.3 `ToolProvider`

当前 `ToolProvider` 接口需要确认是否支持 `registerTool`。若不支持，需要扩展接口或采用替代方案（例如通过 `InMemoryToolProvider` 默认支持，文件工具 provider 通过构造时注入）。

**推荐做法**：扩展 `ToolProvider` 接口，增加可选的 `registerTool(tool: ToolDefinition, handler: ToolHandler): void` 方法。默认实现抛错或不支持；`InMemoryToolProvider` 和 `FileSystemToolProvider` 实现支持。

---

## 7. 错误处理

### 7.1 技能不存在

`readSkillRaw` 返回 `undefined`，工具返回：

```typescript
{ error: `Skill "${name}" not found` }
```

### 7.2 读取失败

`readSkillRaw` 抛出异常，工具返回：

```typescript
{ error: `Failed to read skill "${name}": ${error.message}` }
```

### 7.3 SkillProvider 未注册

Core 初始化时 `SkillProvider` 是默认必加载项，若缺失应在 `registry.initialize()` 阶段报错。

### 7.4 ToolProvider 不支持动态注册

- 默认行为：debug 日志记录跳过原因，不影响 Agent 启动。
- 替代方案：若 `ToolProvider` 为 `file-system` 实现，可在其创建时由 Core 预先把 `read_skill` 注入到它的工具列表中。

---

## 8. 测试策略

### 8.1 单元测试

- `FileSkillProvider.readSkillRaw()`
  - 命中：返回完整 Markdown 原文。
  - 未命中：返回 `undefined`。
  - skillsDir 为空：返回 `undefined`。
  - 文件不存在：返回 `undefined`。

- `DefaultSkillCatalog.format()`
  - 无技能：返回空字符串。
  - 有技能：返回包含引导语 + `<available_skills>` 的字符串。

### 8.2 集成测试

- `ProviderManager` 初始化后，`read_skill` 工具存在于 `ToolProvider` 中。
- 调用 `read_skill({ name })` 返回预期 Markdown 内容。
- 调用 `read_skill({ name: 'nonexistent' })` 返回错误。

### 8.3 端到端测试

- 构造一个带 `SKILL.md` 的技能目录，启动 Agent，验证 system prompt 包含 `<available_skills>` 和引导语。
- 在模拟对话中让模型调用 `read_skill`，验证返回内容被加入后续上下文。

---

## 9. 模块拆分与文件边界

遵循 `module-separation-convention`：

| 文件 | 职责 | 预计行数 |
|---|---|---|
| `packages/core/src/sdk/skill-provider.ts` | `SkillProvider` 接口，新增 `readSkillRaw` | ~20 |
| `packages/core/src/plugins/skill/file/index.ts` | `FileSkillProvider` 实现 `readSkillRaw` | ~95 |
| `packages/core/src/plugins/skill/default-catalog.ts` | `DefaultSkillCatalog` 拼接引导语 | ~45 |
| `packages/core/src/plugins/tool/builtin/skill-read.ts` | `read_skill` 工具定义与执行 | ~60 |
| `packages/core/src/provider-manager.ts` | 初始化完成后注册内置工具 | ~180 |

---

## 10. 待确认与后续扩展

### 10.1 已确认

- `read_skill` 返回完整原始 Markdown（含 frontmatter）。
- 读取逻辑放在 `SkillProvider` 实现中。
- system prompt 中增加分步引导语。

### 10.2 后续可扩展

- **按名称前缀/标签过滤**：`SkillProvider` 可扩展 `listSkills({ tag })`。
- **热重载**：`FileSkillProvider` 监听 `skillsDir` 变化，重新加载。
- **远程技能**：未来可新增 `HttpSkillProvider`，`readSkillRaw` 通过网络请求获取。

---

## 11. 接口速览

```typescript
// sdk/skill-provider.ts
export interface SkillProvider {
  loadSkills(): Promise<Skill[]>;
  formatCatalog(skills: Skill[]): string;
  readSkillRaw(name: string): Promise<string | undefined>;
}

// plugins/tool/builtin/skill-read.ts
export interface ReadSkillToolInput {
  name: string;
}

export function createReadSkillTool(
  getSkillProvider: () => SkillProvider,
): { definition: ToolDefinition; handler: ToolHandler };
```

---

*最后更新：2026-07-06*
