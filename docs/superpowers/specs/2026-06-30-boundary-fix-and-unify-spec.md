# 模块边界修正与架构统一设计

> 日期：2026-06-30 | 基于 `docs/boundary-review.md` 审查报告

---

## 1. 目标

按模块分离规范消除边界违规，删除死代码，拆分超限文件，统一 bridge 服务接口。

### 核心决策

- **`runAgent` 为唯一 agent 执行入口**，删除 `CoreAgent` 类
- **`IAgentService` 统一接口**，`AgentService`（直调）和 `AgentRemoteService`（HTTP）双实现
- **`stream-reducer` 共享**，消除 web/tui 中重复的 chunk 归并 switch-case
- **demo 包删除**，暂不需要

---

## 2. 实施顺序

按依赖关系从底向上：**core → bridge → web/tui**

```
Phase A: Core 层 (27 文件)
Phase B: Bridge 层 (12 文件)
Phase C: Web 层 (7 文件)
Phase D: TUI 层 (4 文件)
Phase E: Demo 删除 + 清理
```

---

## 3. Phase A: Core 层

### 3.1 删除 (5 文件)

| 文件 | 原因 |
|------|------|
| `core-agent.ts` (449行) | 唯一入口改为 `runAgent` |
| `ui/types.ts` | 依赖 CoreAgent，无其他引用 |
| `ui/session.ts` | 同上 |
| `ui/index.ts` | 目录清空 |
| `security/approval-hook.ts` | 全仓无引用的死代码 |

### 3.2 新建 (13 文件)

| 文件 | 内容来源 | 预计行数 |
|------|---------|---------|
| `agent-factory.ts` | 从 `core-agent.ts` 提取 `createAgentFromEnv` | ~60 |
| `loop-types.ts` | 从 `loop-strategy.ts` 拆分接口: `TurnHooks`, `LoopContext`, `LoopResult`, `LoopStrategy` | ~40 |
| `stream/stream-aggregators.ts` | 从 `agent-stream.ts` 拆分: `aggregateSteps`, `aggregateText`, `aggregateUsage` | ~50 |
| `llm/stream-collector.ts` | 从 `llm/types.ts` 拆分: `StreamCollector` + `collectStream` | ~50 |
| `llm/providers/openai-adapter.ts` | 从 `openai.ts` 拆分: `convertToOpenAIMessages`, `convertToOpenAITools` 等消息格式转换 | ~75 |
| `llm/providers/anthropic-adapter.ts` | 从 `anthropic.ts` 拆分: `convertToAnthropicMessages`, `convertToAnthropicTools` | ~70 |
| `plugins/config/default/config-loader.ts` | 从 `index.ts` 拆分: `loadConfigFile`, `resolveConfigPath` | ~30 |
| `plugins/config/default/config-parser.ts` | 从 `index.ts` 拆分: `pickToolPolicy`, `pickModelConfig`, `pickModels`, `resolveTemplate` | ~50 |
| `plugins/config/default/config-merger.ts` | 从 `index.ts` 拆分: `mergeFileConfig`, `mergeEnvConfig`, `applyBehaviorDefaults` | ~60 |
| `plugins/session/base.ts` | 提取 `file` 和 `local` 公共基类: `ensureDir`, `create`, `load`, `save`, `write`, `sessionPath` | ~90 |
| `plugins/skill/default-catalog.ts` | 从 `sdk/skill-provider.ts` 移动 `DefaultSkillCatalog` + `escapeXml` | ~25 |
| `plugins/tool/file-system/edit-schemas.ts` | 从 `edit.ts` 拆分: `replaceEditSchema`, `editSchema` | ~30 |
| `plugins/tool/file-system/edit-recovery.ts` | 从 `edit.ts` 拆分: `didEditLikelyApply`, `removeExactOccurrences`, `appendMismatchHint` | ~40 |

### 3.3 修改 (12 文件)

| 文件 | 变更 | 预计行数 |
|------|------|---------|
| `index.ts` | 移除 CoreAgent/ui 导出，新增 agent-factory 导出 | 23→20 |
| `loop-strategy.ts` | 接口定义移到 loop-types，从此导入接口 | 290→200 |
| `stream/agent-stream.ts` | 聚合方法移到 stream-aggregators，从此导入 | 211→160 |
| `llm/types.ts` | 移除 StreamCollector（移入 stream-collector.ts） | 94→50 |
| `llm/providers/openai.ts` | 适配器函数移入 openai-adapter，从此导入 | 223→130 |
| `llm/providers/anthropic.ts` | 同上 | 162→100 |
| `plugins/config/default/index.ts` | 拆出 loader/parser/merger，此文件保留 DefaultConfigProvider | 253→80 |
| `plugins/session/file/index.ts` | 继承 BaseFileSessionProvider，删除重复代码 | 131→60 |
| `plugins/session/local/index.ts` | 继承基类，仅保留 index/message cache 特有逻辑 | 190→100 |
| `plugins/tool/file-system/edit.ts` | 拆分 schemas + recovery，保留执行器主流程 | 173→100 |
| `sdk/skill-provider.ts` | 移除 DefaultSkillCatalog（移入 plugins/skill/default-catalog） | 47→25 |
| `sdk/index.ts` | 删除第 12 行重复的 `provider-loader.js` 导出 | 12→11 |
| `security/tool-policy-pipeline.ts` | 修复 alsoAllow Bug：只在 allow 和 alsoAllow 都为 undefined 时跳过过滤 | 59→不变 |

### 3.4 验证标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter rem-agent-core test` 通过
- [ ] `index.ts` 导出的公开 API 语义不变（除 CoreAgent/UISession 已删除）
- [ ] 每个文件 ≤ 200 行（除 `loop-strategy.ts` 200 行刚好达标）

---

## 4. Phase B: Bridge 层

### 4.1 新建 (6 文件)

| 文件 | 说明 | 预计行数 |
|------|------|---------|
| `agent-service.interface.ts` | `IAgentService` 接口：`run`, `interrupt`, `reset`, `listSessions` | ~25 |
| `agent-remote-service.ts` | `AgentRemoteService implements IAgentService`，HTTP fetch + SSE 解析 | ~90 |
| `agent-service.ts` | 从 `agent.ts` 重命名，`AgentService implements IAgentService` | ~120 |
| `stream-tap.ts` | 从 `agent.ts` 拆分 `tapFullStream` | ~70 |
| `content-builder.ts` | 从 `agent.ts` 拆分 `buildPartsFromContent` | ~40 |
| `stream-reducer.ts` | `reduceStreamChunk(parts, chunk) → parts` 纯函数，web+tui 共享 | ~100 |

### 4.2 删除/重写

| 文件 | 变更 |
|------|------|
| `client.ts` (75行) | 重写为 `agent-remote-service.ts`，实现 `IAgentService` |
| `agent.ts` (214行) | 重命名 → `agent-service.ts` + 拆分 stream-tap/content-builder |

### 4.3 修改 (5 文件)

| 文件 | 变更 |
|------|------|
| `index.ts` | 新增 `IAgentService`、`AgentRemoteService` 导出；路径 `agent-service.ts` |
| `sessions.ts` | `SessionService` 改为依赖 `IAgentService` 接口而非 `AgentService` 具体类 |
| `types.ts` | 保持不变（请求类型仍需要） |
| `sse.ts` | 保持不变（子路径导出 `./sse`） |
| `response.ts` | 保持不变 |

### 4.4 IAgentService 接口定义

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';

interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
}

interface IAgentService {
  run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>>;
  interrupt(sessionId: string): Promise<void>;
  reset(sessionId: string): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
}
```

### 4.5 stream-reducer 签名

```typescript
interface StreamPart {
  type: 'text' | 'reasoning' | 'tool';
  // ... state fields
}

function reduceStreamChunk(
  parts: StreamPart[],
  chunk: AgentStreamChunk
): StreamPart[];
```

### 4.6 验证标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter rem-agent-bridge test` 通过
- [ ] `IAgentService` 接口由 `AgentService` 和 `AgentRemoteService` 正确实现
- [ ] `./sse` 子路径导出不受影响

---

## 5. Phase C: Web 层

### 5.1 删除 (2 文件)

| 文件 | 原因 |
|------|------|
| `lib/agent-client.ts` | 用 bridge `AgentRemoteService` 替代 |
| `lib/stream-parser.ts` | 直接从 `rem-agent-bridge/sse` 导入 |

### 5.2 修改 (5 文件)

| 文件 | 变更 |
|------|------|
| `lib/container.ts` | DI 注册改为 `AgentRemoteService`，注入为 `IAgentService` |
| `lib/session-store.ts` | `onChunk` 的 switch-case 改为调用 `reduceStreamChunk` from bridge (299→~160 行) |
| `lib/use-sse.ts` | 通过注入的 `IAgentService.run()` 消费流，而非自建 fetch |
| `lib/types.ts` | import 源从 `rem-agent-core` 改为 `rem-agent-bridge` |
| `app/api/agent/run/route.ts` | 类型适配（`AgentService` 路径变化） |

### 5.3 验证标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter rem-agent-web build` 通过
- [ ] session-store.ts ≤ 200 行

---

## 6. Phase D: TUI 层

### 6.1 新建 (3 文件)

| 文件 | 内容来源 | 预计行数 |
|------|---------|---------|
| `ui-layout.ts` | 从 `app.ts` 拆分 `buildUI()` — 创建所有 Renderable 组件并组装布局 | ~80 |
| `session-picker.ts` | 从 `app.ts` 拆分 `showPicker`/`hidePicker`/`switchSession` | ~70 |
| `commands.ts` | 从 `app.ts` 拆分 `handleNewSession`/`handleResumeCommand` | ~50 |

### 6.2 修改 (1 文件)

| 文件 | 变更 | 预计行数 |
|------|------|---------|
| `app.ts` | 构造函数接收 `IAgentService` 接口；`handleChunk` 改用 `reduceStreamChunk`；拆出 UI/commands/picker | 471→~120 |

### 6.3 TUIApp 接口变化

```
// 当前
new TUIApp({ serverUrl, sessionId, maxTurns })

// 修正后
new TUIApp({ agentService: IAgentService, sessionId, maxTurns })
```

### 6.4 验证标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter rem-agent-tui test` 通过
- [ ] app.ts ≤ 150 行

---

## 7. Phase E: Demo 删除 + 清理

| 操作 | 说明 |
|------|------|
| 删除 `packages/demo/` | 整个包 |
| 更新 `pnpm-workspace.yaml` | 移除 demo 引用（如有） |
| 更新根 `package.json` | 移除 demo 相关脚本（如有） |
| 更新 `CLAUDE.md` | 移除 demo 相关命令和说明 |
| 更新 `docs/architecture.md` | 移除 demo 相关描述 |

---

## 8. 文件变化汇总

| 包 | 删除 | 新建 | 修改 | 净变化 |
|----|------|------|------|--------|
| core | 5 | 13 | 12 | +8 (78→86) |
| bridge | 2 (重写) | 6 | 5 | +4 (8→12) |
| web | 2 | 0 | 5 | -2 (22→20) |
| tui | 0 | 3 | 1 | +3 (5→8) |
| demo | **全部** | 0 | 0 | -2 |
| **合计** | **9 + demo全包** | **22** | **23** | **+11 (不含demo)** |

---

## 9. 风险与回滚

| 风险 | 缓解 |
|------|------|
| `run-agent` 缺少 CoreAgent 的生命周期功能 | bridge AgentService 已通过 AbortController + activeRuns 管理生命周期，确认无缺失 |
| agent-factory 环境变量解析逻辑遗漏 | 从 core-agent.ts 原样提取，不修改逻辑 |
| 拆分后的 imports 循环依赖 | 拆分时遵循：新建模块只被旧模块导入，旧模块从不被新建模块导入 |
| web/tui 改接口后功能异常 | Phase C/D 完成后进行端到端 smoke test |
| 删除 demo 后 `pnpm test` 失败 | 更新根 workspace 脚本，移除 demo 引用 |

---

## 10. 实施检查清单

- [ ] Phase A: Core 层变更完成，typecheck + test 通过
- [ ] Phase B: Bridge 层变更完成，typecheck + test 通过
- [ ] Phase C: Web 层变更完成，typecheck + build 通过
- [ ] Phase D: TUI 层变更完成，typecheck + test 通过
- [ ] Phase E: Demo 清理完成
- [ ] `pnpm typecheck` 全仓通过
- [ ] `pnpm test` 全仓通过
- [ ] `CLAUDE.md` 和 `docs/` 文档同步更新
