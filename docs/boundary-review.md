# 模块边界审查报告

> 审查日期：2026-06-30 | 审查范围：rem-agent 全部 5 个包

## 总览

| 严重度 | 数量 |
|--------|------|
| 高 | 7 |
| 中 | 13 |
| 低 | 10 |
| **合计** | **30** |

---

## 🔴 高严重度

### 1. `packages/core/src/core-agent.ts` — 449 行，超绝对上限 2.2 倍

**问题：** 四种职责混合在一个文件：
- `CoreAgentConfig` 类型定义
- `CoreAgent` 类实现（生命周期管理）
- `createAgentFromEnv()` 工厂函数（第 392-449 行）
- `generateTitle()` 标题生成逻辑（第 325-361 行）

其中 `createAgentFromEnv` 允许调用方传入 `apiKey`/`baseURL`/`model` 参数，与 CLAUDE.md 红线规则存在设计矛盾（客户端可能绕过 Core 的 Provider 配置解析）。

**建议：**
- 拆出 `core-agent-config.ts`（类型定义）
- 拆出 `core-agent-factory.ts`（`createAgentFromEnv`）
- 移除工厂函数的 `apiKey`/`baseURL`/`model` 参数，强制由 Core 解析 Provider 配置

---

### 2. `packages/core/src/run-agent.ts` — 210 行，与 CoreAgent 有大量重复逻辑

**状态：** ✅ 已确认保留 `run-agent` 为独立模块（不合并到 CoreAgent）。

**问题：**
- 第 35-201 行与 `CoreAgent.run()` 在状态管理、budget 检查、turn 执行上有大量重复
- 标题生成逻辑（第 74-133 行）与 `core-agent.ts:325-361` 近乎完全重复，且两处实现已产生微小分歧

**建议：**
- `run-agent` 与 `CoreAgent` 保持为两条独立路径，但提取共享逻辑到公共模块
- 标题生成：提取为 `shared/generate-title.ts`（纯函数），两侧复用
- Turn 构建、budget 初始化、stream controller 创建等辅助逻辑抽取为 `shared/run-helpers.ts`

---

### 3. `packages/core/src/loop-strategy.ts` — 290 行，超绝对上限 1.45 倍

**问题：** 接口定义（`TurnHooks`, `LoopContext`, `LoopResult`, `LoopStrategy`）与实现类 `ReactLoop` 混合。`ReactLoop.iterate()` 方法承担推理、工具执行、skill 加载、流映射四重职责。

**建议：** 拆出 `loop-types.ts`（接口定义），`ReactLoop.iterate()` 拆分为 `reason()` / `execute()` / `enrich()` 私有方法。

---

### 4. `packages/tui/src/app.ts` — 471 行，超绝对上限 3 倍

**问题：** 单一文件承载 6 种职责：
- UI 布局构建（`buildUI`, 55 行）
- 流式消息处理（`handleChunk`, 125 行巨型 switch-case）
- 消息展示（`addUserText`/`addAssistantText`/`clearChat`）
- 命令处理（`handleNewSession`/`handleResumeCommand`）
- Session 选择器浮层（`showPicker`/`hidePicker`/`switchSession`, ~60 行）
- 键盘绑定 + 状态栏更新

其中 `handleChunk`（125 行）与 `web/src/lib/session-store.ts:onChunk`（110 行）是**几乎重复的逻辑**——都是对 `AgentStreamChunk` 的 switch-case 状态归并。

**建议：**
| 新文件 | 职责 | 预计行数 |
|--------|------|------|
| `app.ts` | 应用编排 + 生命周期 | ~80 行 |
| `stream-handler.ts` | chunk → parts 状态归并（纯函数，供 tui+web 共享） | ~120 行 |
| `ui-layout.ts` | buildUI + 布局构建 | ~80 行 |
| `session-picker.ts` | overlay/picker 逻辑 | ~70 行 |
| `commands.ts` | /new /resume 命令 | ~50 行 |

---

### 5. `packages/web/src/lib/session-store.ts` — 299 行，超绝对上限 1.5 倍

**问题：** Zustand store 混入 3 类职责：
- Session CRUD（init/create/select/rename/delete/togglePin）
- 流式消息状态机（sendMessage + onChunk 110 行 switch-case，与 tui 重复）
- UI 状态（searchQuery/reconnecting/serverError/pendingContent）

`onChunk` 的 switch-case 处理 11 种 chunk 类型，与 tui 的 `handleChunk` 逻辑高度一致。两者的唯一区别是目标数据结构（zustand state vs TUI renderable tree），但**状态归并逻辑完全可共享**。

**建议：**
| 新文件 | 职责 | 预计行数 |
|--------|------|------|
| `session-store.ts` | Session CRUD + UI 状态 | ~150 行 |
| `stream-reducer.ts` | 纯函数：`(parts, chunk) => parts`（可被 tui 复用） | ~100 行 |

---

### 6. `packages/core/src/security/approval-hook.ts` — 16 行，完全死代码

**问题：** 定义了 `ApprovalHook` 类型和 `defaultApprovalHook` 常量，但整个 core 包内无任何文件引用它。`security/index.ts` 也不导出它。`ToolHookRunner` 使用的是 `sdk/tool-hook.js` 中的 `ToolHook` 接口，与 `ApprovalHook` 是两套不同体系。

**建议：** 确认无外部引用后直接删除。

---

### 7. `packages/core/src/security/tool-policy-pipeline.ts` — alsoAllow 被忽略的 Bug

**问题：** `applyLayer` 函数（第 42-58 行）中：

```typescript
const allow = layer.allow ?? layer.alsoAllow;
if (allow) {
    if (allow.length === 0) {
      return [];           // ← allow=[] 为 truthy，直接返回空
    }
}
```

当 `layer.allow = []`（空数组）且 `layer.alsoAllow = ['read']` 时，`allow` 取值为 `[]`（空数组是 truthy），条件成立后直接返回空数组，**`layer.alsoAllow` 中的 `['read']` 被完全忽略**。

**建议：** 只在 `layer.allow === undefined && layer.alsoAllow === undefined` 时跳过过滤；单独处理 `allow` 为空数组时的语义。

---

## 🟡 中严重度

### 8. `packages/core/src/plugins/config/default/index.ts` — 253 行，5 种职责混合

**问题：** 配置文件加载、路径解析、模板替换、配置提取（pick* 系列）、合并逻辑、类实现全部混在一起。

**建议：** 拆出 `config-loader.ts`、`config-parser.ts`、`config-merger.ts`，`DefaultConfigProvider` 类精简到 ~80 行。

---

### 9. `packages/core/src/plugins/session/file` 和 `session/local` — 大量重复代码

**问题：** `ensureDir()`、`create()` 结构、`load()` 反序列化、`save()` 序列化、`createProvider()` + `getDefaultOptions()` 完全一致。`local` 仅多出 `_msgCache`、`cueMessages`/`pullMessages`、`delete` 和 index 管理。

**建议：** 提取 `BaseFileSessionProvider` 基类，`local` 继承并扩展。减少约 80-100 行重复代码。

---

### 10. `packages/core/src/stream/agent-stream.ts` — 211 行，超绝对上限

**问题：** `RawChunk` 类型定义与 `AgentStreamController` 类混合。聚合方法 `aggregateSteps`（35 行）可在类外实现。

**建议：** 将 `aggregateSteps` 抽取为独立函数。

---

### 11. `packages/core/src/llm/providers/openai.ts` — 223 行，适配器+Provider 混合

**问题：** 消息格式转换函数（`convertAssistantContent`、`convertToOpenAIMessages`、`convertToOpenAITools`，~70 行）属于适配器逻辑，与 provider 实现（`generate`、`stream`）混合。

**建议：** 拆出 `openai-adapter.ts`（消息格式转换），provider 主体保留 `generate` + `stream`。

---

### 12. `packages/core/src/llm/types.ts` — 类型文件混入实现类

**问题：** 文件名为 `types.ts`，但第 48-93 行包含了 `StreamCollector` 类 + `collectStream` 函数（47 行实现代码）。

**建议：** `StreamCollector` 移至 `llm/stream-collector.ts`。

---

### 13. `packages/core/src/sdk/skill-provider.ts` — SDK 接口文件包含默认实现

**问题：** SDK 接口文件应仅含接口定义，但第 17-39 行包含了 `DefaultSkillCatalog` 类和 `escapeXml` 实现函数。这违反了模块分离规范："SDK 接口与实现分离"。

**建议：** `DefaultSkillCatalog` 移至 `plugins/skill/`。

---

### 14. `packages/core/src/provider-manager.ts` — 与 CoreAgent 功能重叠

**问题：** `ProviderManager.init()`（第 53-89 行）与 `CoreAgent.ready()` + `createRegistry()` 在 Provider 加载逻辑上重叠。两者都创建 `DefaultProviderLoader` + `AgentProviderRegistry` + 调用 `registerBuiltInProviders()` + 解析配置。

**建议：** 明确关系：要么 `CoreAgent` 内部使用 `ProviderManager`，要么废弃 `ProviderManager` 统一使用 `CoreAgent`。

---

### 15. 插件层违反 SDK-only 依赖原则

**问题：** 以下插件文件直接导入了 core 的内部模块（非 SDK 接口）：

| 插件文件 | 依赖的 core 内部模块 |
|----------|---------------------|
| `plugins/tool/file-system/index.ts` | `registry/tool-registry.js` |
| `plugins/tool/file-system/read.ts` | `security/workspace-root-guard.js` |
| `plugins/tool/file-system/edit.ts` | `security/workspace-root-guard.js` |
| `plugins/tool/file-system/write.ts` | `security/workspace-root-guard.js` |
| `plugins/tool/file-system/ls.ts` | `security/workspace-root-guard.js` |
| `plugins/config/default/index.ts` | `config/paths.js` |
| `plugins/skill/file/index.ts` | `utils/skill-parser.js` |

**建议：** `workspace-root-guard` 的路径解析能力通过扩展 `ToolContext` 接口注入；`AgentToolRegistry` 通过 SDK 接口抽象；`config/paths.js` 中的函数放入 `ProviderLoaderContext`。

---

### 16. Session Provider 的 `create()` 语义不一致

**问题：** 三个 session provider 的 `create()` 行为不同：
- `file`：生成 sessionId 后**立即写磁盘**，写失败则抛异常
- `local`：生成 sessionId 后**不写磁盘**
- `in-memory`：写入内存 Map，总是成功

**建议：** 统一 `create()` 行为规范。文件型要么持久化成功再返回 ID，要么延迟写入（与 local 一致）。

---

### 17. `packages/web/src/lib/agent-client.ts` — 与 bridge AgentClient 完全重复

**问题：** web 包的 `agent-client.ts`（70 行）实现了 `runAgent`/`interruptAgent`/`listSessions`/`createSession` 等函数，而 `bridge/src/client.ts`（75 行）的 `AgentClient` 类提供了完全相同的功能。web 已经依赖 `rem-agent-bridge`，但没有复用。

**建议：** web 直接使用 `new AgentClient('')`（空字符串表示相对路径），删除 `web/src/lib/agent-client.ts`。

---

### 18. `packages/web/src/lib/types.ts` — 越界依赖 core 类型

**问题：** 直接从 `rem-agent-core` 导入 `AgentStreamChunk`、`ServerMessage`、`ContentPart` 等类型。根据分层原则，web 应通过 bridge 间接消费 core 的类型。bridge 已在 `index.ts` 中 re-export 了这些类型。

**建议：** 将 import 源改为 `rem-agent-bridge`。

---

### 19. `packages/bridge/src/agent.ts` — 214 行，可拆出独立模块

**问题：** `tapFullStream`（77 行，流拦截与 content parts 积累）和 `buildPartsFromContent`（40 行，内容反序列化）是可独立提取的纯函数模块。

**建议：** 拆出 `stream-tap.ts`(~70 行) 和 `content-builder.ts`(~40 行)，`agent.ts` 缩减到 ~120 行。

---

### 20. `packages/web/src/lib/stream-parser.ts` — 2 行纯重导出

**问题：** 仅重导出 `rem-agent-bridge/sse` 的 `parseSSEStream`、`parseAgentStreamEvent`、`SSEEvent`，不提供任何附加值。

**建议：** `use-sse.ts` 改为直接从 `rem-agent-bridge/sse` 导入，删除 `stream-parser.ts`。

---

## 🟢 低严重度

### 21. `packages/core/src/plugins/tool/file-system/edit.ts`（173 行）

与 `edit-diff.ts` 的 BOM/行结束符处理重叠。`edit.ts` 执行器手动处理了 BOM 剥离 + 行结束符检测 + LF 规范化，而 `computeEditsDiff` 又做了完全相同的操作。建议让 `computeEditsDiff` 接受已预处理的内容，避免重复计算。

---

### 22. `packages/core/src/llm/providers/anthropic.ts`（162 行）

超 150 行指导线 12 行。与 openai.ts 同结构，建议同样拆分适配器函数。

---

### 23. `packages/core/src/shared/text/code-regions.ts`（173 行）

`createCodeRegionScanner` 内部的 `processNext` 函数体过大（~80 行），可拆分为 `processFenceState` 和 `processInlineState` 子函数。

---

### 24. `packages/core/src/sdk/index.ts` — 重复导出行

第 11 行和第 12 行完全相同：`export * from './provider-loader.js';`。明显的复制粘贴错误，删除任意一行即可。

---

### 25. `packages/core/src/plugins/config/default/index.ts` — 缺少优雅降级

`const { parse } = await import('yaml');` 如果 `yaml` 包未安装，抛出异常且错误信息不明确。建议添加明确的错误包装。

---

### 26. `packages/web/src/lib/container.ts` — 读取环境变量

第 7-9 行直接读取 `process.env.SESSIONS_DIR`。不算违规（不是 API 密钥），但更干净的做法是由 core 提供 `resolveSessionsDir()`。

---

### 27. `packages/tui/src/message/tool-formatter.ts`（148 行）

接近 150 行指导线。定义 5 个 ToolFormatter，每个 ~20-40 行。暂可不变，但后续新增 formatter 时应拆到 `tool-formatter/` 目录。

---

### 28. `packages/core/src/security/workspace-root-guard.ts` — safeRealpath 失败回退

`safeRealpath` 在 `realpathSync` 失败时返回原路径，若路径通过符号链接指向工作区外，理论上会削弱安全检查。实际风险极低，但建议失败时记录警告日志。

---

### 29. `packages/core/src/security/approval-manager.ts` — 非空断言

Promise 构造器中使用 `resolve: resolveFn!` 非空断言。虽然赋值在 executor 中保证完成，但 TypeScript 无法证明。可用 deferred 对象模式替代。

---

### 30. `packages/core/src/plugins/tool/file-system/ls.ts` — 硬绑定平台依赖

`defaultLsOperations` 直接使用 `node:fs` 的同步 API，硬绑定了 Node.js 平台。可接受（file-system 插件的性质决定），但应在文档中声明平台依赖。

---

## 优先修复路线图

| 优先级 | 编号 | 行动 | 涉及文件 |
|--------|------|------|----------|
| **P0** | #6 | 删除死代码 | `core/src/security/approval-hook.ts` |
| **P0** | #7 | 修复 alsoAllow Bug | `core/src/security/tool-policy-pipeline.ts` |
| **P0** | #1, #2 | 拆分 core-agent.ts + 提取 run-agent 与 CoreAgent 共享逻辑 | `core-agent.ts`, `run-agent.ts`, `shared/` |
| **P1** | #4, #5 | 拆分 tui app.ts + 提取共享 chunk reducer | `tui/src/app.ts`, `web/src/lib/session-store.ts` |
| **P1** | #9 | 提取 session provider 基类 | `plugins/session/file/`, `plugins/session/local/` |
| **P2** | #17, #18, #20 | 消除 web 包越界与重复依赖 | `web/src/lib/agent-client.ts`, `types.ts`, `stream-parser.ts` |
| **P2** | #8 | 拆分 config/default/index.ts | `plugins/config/default/` |
| **P2** | #15 | 修复插件层 SDK-only 依赖 | `plugins/tool/file-system/*` |
| **P3** | #3, #10, #11, #12, #13, #14, #19 | 拆分超限文件 | `loop-strategy.ts`, `openai.ts`, `agent-stream.ts`, `llm/types.ts`, `sdk/skill-provider.ts`, `provider-manager.ts`, `bridge/agent.ts` |
| **P3** | #24 | 修复 sdk/index.ts 重复导出 | `sdk/index.ts` |
| **P4** | #21~#23, #25~#30 | 低严重度优化 | 各文件 |

---

*审查完成：2026-06-30*
