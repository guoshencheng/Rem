# AgentPaths: 路径约定集中管理与依赖注入

## 问题

项目中文件/目录路径约定散落在多个模块内部硬编码，导致：

1. **不一致**：`config/paths.ts` 定义了 `~/.rem-agent/skills`，但 `FileSkillProvider` 实际读取 `~/.agents/skills`——两套目录定义各自维护。
2. **耦合**：Provider 模块内部直接引用 `homedir()`、`join()`、`process.env`，与运行环境紧密耦合，难以测试和替换。
3. **不可配置**：外部无法覆盖路径（除非通过环境变量间接影响），不符合 Provider 的设计原则——Provider 应该消费配置，而不是自己去解析配置。

## 原则

- **目录级路径**（`.rem-agent/`、`sessions/` 等）集中到 `AgentPaths` 接口，创建 Agent 时注入。因为它们可能随环境、部署方式变化。
- **文件级命名**（`SKILL.md`、`.jsonl`、`.meta.json` 等）留在各 Provider 作为私有常量。因为它们与 Provider 实现绑定，换实现自然换命名。

## 设计

### AgentPaths 接口

```typescript
// packages/core/src/config/paths.ts

export interface AgentPaths {
  /** Agent 数据根目录 */
  readonly agentDir: string;

  /** 用户级技能目录，默认 ~/.agents/skills */
  readonly homeSkillsDir: string;

  /** 项目级技能目录，默认 <workspaceRoot>/.agents/skills */
  workspaceSkillsDir(workspaceRoot: string): string;

  /** 配置文件候选列表（优先级从高到低） */
  configCandidates(cwd: string): string[];

  /** 会话存储目录 */
  readonly sessionsDir: string;

  /** 调试日志路径，null 表示禁用 */
  readonly debugLogFile: string | null;
}
```

### 默认创建函数

```typescript
export interface CreateAgentPathsOptions {
  agentDir?: string;
  homeSkillsDir?: string;
  sessionsDir?: string;
  env?: Partial<NodeJS.ProcessEnv>;
}

export function createDefaultAgentPaths(opts?: CreateAgentPathsOptions): AgentPaths;
```

- 默认行为沿用现有约定：prod 用 `~/.rem-agent`，dev 用 `<cwd>/.rem-agent`
- `homeSkillsDir` 默认 `~/.agents/skills`（沿袭 FileSkillProvider 实际使用的路径，废弃之前 `config/paths.ts` 里定义的 `~/.rem-agent/skills`）
- `debugLogFile` 由 `REM_AGENT_DEBUG` / `REM_AGENT_DEBUG_FILE` 环境变量控制
- `resolveTilde()` 保留为独立工具函数导出（workspace-root-guard 等安全模块需要）

### Provider 改造

| 模块 | 改动 |
|---|---|
| `FileSkillProvider` | constructor 接收 `paths: AgentPaths`，从 `paths.homeSkillsDir` 和 `paths.workspaceSkillsDir(root)` 取值，删除内部 `resolveHomeSkillsDir` / `resolveWorkspaceSkillsDir` 函数 |
| `config-loader.ts` | `resolveConfigPath(explicitPath, cwd, paths: AgentPaths)`，candidates 从 `paths.configCandidates(cwd)` 获取 |
| `DefaultConfigProvider` | constructor 接收 `paths: AgentPaths`，透传给 config-loader |
| `JsonlSessionStore` | **不改**。dir 已由外部注入，`.jsonl` / `.meta.json` 是私有常量 |
| `LocalSessionProvider` | **不改**。dir 已由外部注入，`index.json` / `.msg.json` 是私有常量 |
| `debug-log.ts` | 暴露 `configureDebugLog(file: string | null)`，由外部在初始化时调用，删除内部的 `resolveDebugFile` |
| `agent-factory.ts` | 创建 `paths = createDefaultAgentPaths(opts)`，注入到各 Provider |
| `tests/setup.ts` | `REM_AGENT_HOME = '/tmp/rem-agent-test'` 改为通过 `createDefaultAgentPaths({ agentDir: '/tmp/rem-agent-test' })` |

### 注入入口

```
createAgentFromEnv(opts)
  → createDefaultAgentPaths(opts)
  → new DefaultConfigProvider(paths, { configPath, cwd })
  → new FileSkillProvider(configProvider, paths)
  → new JsonlSessionStore(paths.sessionsDir)
  → configureDebugLog(paths.debugLogFile)
```

## 影响范围

- `config/paths.ts`：从 4 个函数扩展到完整的 `AgentPaths` 接口 + `createDefaultAgentPaths`
- `agent-factory.ts`：~10 行变更，创建 paths 并注入
- `FileSkillProvider`：~10 行变更，constructor 参数切换
- `config-loader.ts`：~3 行变更，candidates 参数化
- `DefaultConfigProvider`：~5 行变更，constructor 加 paths
- `debug-log.ts`：~5 行变更，暴露 configureDebugLog
- `tests/setup.ts`：~3 行变更
- `JsonlSessionStore`、`LocalSessionProvider`：不改

## 非目标

- 构建配置路径（tsconfig、vitest、pnpm-workspace）不在本次范围内
- OS 路径处理工具函数（workspace-root-guard 中的 Unicode/macOS 处理）不在本次范围内
