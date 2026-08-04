# Agent 插件与 System Prompt 扩展设计

## 背景

Core 当前通过 `AgentDI` 注入配置、存储、工具、技能、压缩器等运行时依赖。System prompt 已经具有 `PromptSection` 和 `SystemPromptAssembler` 抽象，但 `resolveSystemPrompt()` 仍直接调用 `createDefaultSystemPromptAssembler()`。因此提示词默认实现的选择停留在运行路径内，接入方无法组合多个独立扩展，也无法为未来的插件启停保留稳定边界。

本设计引入一套薄的统一 Agent 插件协议。第一阶段只实现 system prompt capability，允许插件按 section 名新增、替换、删除和重排提示词 section。协议需要支持启动时静态注册，并为未来动态安装、启停和其他 capability 留出演进空间。

## 设计目标

- 明确 DI 与插件的职责边界。
- 支持多个插件按配置顺序组合 system prompt 贡献。
- 使用 section 名作为稳定身份；同名 `set` 直接替换。
- 只将 `runtime` 的最终位置定义为稳定顺序约束。
- 允许替换 `runtime` 内容，但不允许移动或删除它。
- 插件装配失败时不产生部分有效的运行时对象。
- 运行阶段只消费不可变的最终 assembler，不感知插件和可变 registry。
- 为未来动态启停插件预留通过完整重建生成新快照的路径。

## 非目标

第一阶段不实现：

- 插件发现、磁盘扫描和动态代码加载。
- 插件安装、卸载、版本解析、依赖关系或拓扑排序。
- 插件权限和沙箱。
- tool、skill、事件 hook 等其他 capability 的具体注册器。
- 热更新管理器和运行中 assembly 的原子切换。
- 数字优先级。
- Core 默认 sections 之间的稳定顺序承诺。

## 核心决策：DI 与插件分层共存

DI 和插件解决不同问题，不互相替代：

- `AgentDI` 定义 Agent 运行时实际依赖的最终能力。依赖已经完成解析，可以直接消费，并具有明确生命周期。
- `AgentPlugin` 定义装配过程如何被扩展。插件向特定 capability 注册贡献，但不进入 Agent 的日常执行路径。
- Core 拥有默认能力、装配流程、保护规则和最终校验。

System prompt 的装配关系如下：

```text
Core default sections
        ↓
AgentPlugin contributions
        ↓
PromptSectionRegistry validation/finalize
        ↓
immutable SystemPromptAssembler
        ↓
AgentDI.systemPromptAssembler
```

`PromptSectionRegistry` 和 `PluginHost` 都是装配期对象，不进入 `AgentDI`。`AgentDI` 只增加最终的 `SystemPromptAssembler`。

## 统一插件协议

插件协议保持最小：

```ts
export interface AgentPlugin {
  readonly name: string;
  register(context: PluginRegistrationContext): void | Promise<void>;
}

export interface PluginRegistrationContext {
  readonly systemPrompt: PromptSectionRegistry;
}
```

第一阶段 `PluginRegistrationContext` 只有 `systemPrompt`。未来可以增加 tool、skill 或生命周期 capability，而不改变 `AgentPlugin` 主协议。

同一次装配中的插件名必须唯一。插件数组顺序就是注册顺序和覆盖顺序，不额外引入数字优先级。

## Prompt section registry

### 稳定接口

```ts
export interface PromptSectionRegistry {
  set(name: string, section: PromptSection): void;
  delete(name: string): boolean;
  moveBefore(name: string, anchor: string): void;
  moveAfter(name: string, anchor: string): void;
  has(name: string): boolean;
}
```

section 名和插件名使用以下格式：

```text
^[a-z][a-z0-9-]*$
```

section 不强制使用插件命名空间。同名覆盖是正式能力，插件可以有意替换 Core 默认 section 或其他插件的贡献。

### `set` 语义

- 新名字插入到 `runtime` 之前。
- 已存在的名字直接替换内容并保留当前所在位置。
- `set("runtime", section)` 可以替换内容，但 `runtime` 仍保持最后位置。
- 参数 `name` 必须与 `section.name` 一致，否则装配失败。
- 后执行的插件覆盖先执行插件的同名贡献，即 last-write-wins。

### 删除与移动语义

- 普通 section 可以删除。
- 删除不存在的普通 section 返回 `false`。
- 普通 section 可以通过 `moveBefore` 和 `moveAfter` 显式重排。
- 移动的 section 或锚点不存在时装配失败，避免配置静默失效。
- `runtime` 不可删除、不可移动。
- 其他 section 不可移动到 `runtime` 之后。

### 顺序契约

唯一稳定的默认顺序不变量是 `runtime` 始终位于所有 sections 最后。

Core 可以按当前实现中的顺序注册 `tooling`、`execution-bias`、`safety`、`agents-md`、`skills`、`workspace` 等默认 section，但该相互顺序是实现细节，不属于公共兼容承诺。插件如果依赖某个相对顺序，必须显式调用移动 API。

提示词 template 位于 section registry 之外，仍由 `AgentPromptTemplateSelector` 选择并渲染在 sections 之前。第一阶段插件不能替换 template selector。

### 来源与诊断

registry 内部记录每个 section 的当前来源及覆盖历史，例如：

```text
safety:
  initially core
  replaced by company-policy
  replaced by project-policy
```

同名覆盖本身不是警告或错误。来源信息用于调试、未来插件管理和可观测性。

### 最终快照

所有插件执行完成后，registry 输出 `readonly PromptSection[]`。`SystemPromptAssembler` 只持有该不可变快照，不持有可变 registry。

## 插件注册事务

每个插件在独立草稿上执行注册操作：

1. 从当前已提交状态创建草稿。
2. 插件在草稿 registry 上执行 `set`、`delete` 和移动操作。
3. 插件完成后校验名称、引用目标和 `runtime` 约束。
4. 校验成功后提交整个草稿。
5. 插件抛错或违反规则时丢弃草稿，回滚该插件的全部贡献。

插件注册采用 fail-fast。任一插件失败都会使 `createAgentAssembly()` 失败，不生成缺少部分业务或安全提示词的 assembly。

传给插件的 registry 是本次 `register()` 调用的限时视图。`register()` resolve 或 reject 后该视图立即失效，后续任何操作都抛出错误。插件不得保存 registry 引用并在注册完成后修改装配状态；异步贡献必须在其返回的 Promise 完成前执行并等待完成。

## 装配与运行数据流

`createAgentAssembly()` 增加 `plugins?: readonly AgentPlugin[]`：

```text
createAgentAssembly({ plugins })
  → 创建带 Core 默认 sections 的 registry
  → PluginHost 按数组顺序执行插件
  → registry.finalize() 生成不可变快照
  → 创建 SystemPromptAssembler
  → 将 assembler 写入 AgentDI
```

`resolveSystemPrompt()` 继续负责加载 skills、列出工具摘要并构造 `PromptBuildContext`，但不再创建默认 assembler。它改为调用：

```ts
return di.systemPromptAssembler.assemble(buildContext);
```

运行路径由此不再知道默认模板、默认 sections、registry 或插件。

## 动态启停的演进路径

未来启停插件时，不在现有 registry 上反向撤销单个插件。因为插件可能覆盖此前贡献，也可能执行多次删除和移动，逆操作无法稳定恢复原始状态。

动态管理器应保存：

```text
Core defaults + ordered enabled plugin list
```

每次插件集合变化后执行完整重建：

```text
enabled plugins changed
  → 创建全新默认 registry
  → 重放所有启用插件
  → 校验并生成新 assembler
  → 原子发布新快照
```

已经开始的 Agent turn 继续使用旧快照，之后开始的 turn 使用新快照。若重建失败，则保留旧快照。第一阶段只保证当前静态装配模型与这条演进路径兼容，不实现动态管理器。

## 错误模型

公开可识别的装配错误包括：

- `DuplicatePluginNameError`：同一次装配出现重复插件名。
- `PromptSectionIdentityError`：名称格式非法，或 `set` 的名字与 `section.name` 不一致。
- `ProtectedPromptSectionError`：删除或移动 `runtime`，或把其他 section 移到它之后。
- `PromptSectionNotFoundError`：移动的 section 或锚点不存在。
- `PluginRegistrationError`：包装插件执行期间的错误，包含 `pluginName` 和原始 `cause`。

section 的 `render()` 在运行阶段失败时，`SystemPromptAssembler` 继续抛出错误，不静默省略。section 可能包含关键业务规则或安全上下文，静默降级会不可见地改变 Agent 行为。

## 模块划分

现有 `src/plugins/` 表示 Config、Storage、Tool 等 SDK 抽象的内置实现，不承载新的 Agent 插件系统，以免混淆“Provider 实现”和“可注册扩展”。

建议结构：

```text
src/
├── sdk/
│   ├── agent-plugin.ts
│   └── system-prompt.ts
├── plugin-system/
│   └── plugin-host.ts
├── system-prompt/
│   ├── section-registry.ts
│   ├── default-sections.ts
│   ├── assembler.ts
│   ├── templates/
│   └── sections/
└── assembly/
    ├── agent-di.ts
    ├── agent-assembly.ts
    └── agent-context-assembler.ts
```

职责边界：

- `sdk/agent-plugin.ts` 只定义稳定插件协议。
- `sdk/system-prompt.ts` 定义 prompt 相关稳定接口；若实现时超过模块大小建议值，再按职责拆分 SDK 文件。
- `plugin-system/plugin-host.ts` 负责插件顺序、名称唯一性、事务边界和错误包装，不实现 prompt 排序规则。
- `system-prompt/section-registry.ts` 负责有序集合、覆盖、移动、保护规则和快照。
- `system-prompt/default-sections.ts` 只创建 Core 默认 sections。
- `assembly/` 组合上述对象，并把最终 assembler 放入 DI。

## 测试策略

### Registry 单元测试

- 新 section 默认添加到 `runtime` 前。
- 同名 `set` 替换实现并保留当前位置。
- `runtime` 内容可替换且仍在最后。
- 普通 section 可以删除和移动。
- `runtime` 不能删除或移动。
- 其他 section 不能移动到 `runtime` 后。
- `set` 的名字和 `section.name` 不一致时失败。
- 移动的 section 或锚点不存在时失败。
- 不测试 Core 默认 sections 的相互顺序。

### PluginHost 单元测试

- 插件严格按数组顺序执行。
- 后注册插件覆盖先注册插件。
- 重复插件名导致装配失败。
- 插件执行多个操作后抛错时，其全部操作回滚。
- 包装错误保留插件名和原始原因。

### Assembly 集成测试

- 无插件时生成与当前行为等价的 system prompt。
- 插件可以新增、替换、删除和移动普通 section。
- 插件可以替换 `runtime` 内容但不能改变其位置。
- `resolveSystemPrompt()` 使用 DI 中的 assembler。
- Agent turn 内不再重新创建默认 assembler。
- assembler 在一次执行期间使用不可变 section 快照。

### 未来动态能力的契约约束

- 插件集合变化通过完整重建实现，而不是撤销单个插件。
- 新快照发布不影响已开始的 turn。
- 重建失败时继续使用旧快照。

## 验收标准

- 接入方可以在 `createAgentAssembly()` 中按顺序传入多个 `AgentPlugin`。
- 插件可以通过稳定 registry API 操作 prompt sections。
- 同名 `set` 直接替换，且普通 section 的顺序仅由当前状态和显式移动决定。
- `runtime` 内容可替换，但最终永远位于最后且不可删除。
- 插件失败具有事务性并阻止 assembly 创建。
- Agent 运行路径只依赖 `AgentDI.systemPromptAssembler`。
- 第一阶段 API 不妨碍未来新增 capability 或通过完整重建支持动态启停。
