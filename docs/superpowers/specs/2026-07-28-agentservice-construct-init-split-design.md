# AgentService 构造/init 分离 + ConfigProvider.init 接口化

## 目标

1. `new AgentService(options)` 时同步完成 DI 装配并创建 `AgentServiceCore`；`init()` 只负责异步资源（db 持久化规则、MCP 连接、注入 storage 的 init）。
2. `ConfigProvider` 接口定义上包含 `init(): Promise<void>`（必需方法），消除 `await (configProvider as { init?: ... }).init?.()` 的 as 写法。
3. `DefaultConfigProvider` 构造函数同步加载配置（`options.paths` 提供时），配置在 `new` 后即可读。

## 前置约束（探查结论）

- `createFileSystemTools`、`FileSkillProvider`、`LLMSummarizingCompressor` 构造时即读 config → config 必须先就绪（走构造同步加载路线，已确认）。
- `SqliteStorageProvider.sessionStore` getter 在 init 前抛 `StorageError`（provider.ts:60）→ 同步装配要求 storage 构造即可用。better-sqlite3 全部同步 API，开库/迁移可移入构造函数。
- `buildAgentContext` 的 async 依赖只剩三个：`storage.init()`、`ruleStore.loadAll()`（依赖 db）、`mcpManager.connectAll()`。
- `buildRuleSecurity` 仅 browser.ts 导出 + assembler 内部使用，无外部消费方，可安全移除。

## 改动设计

### 1. ConfigProvider 接口（core）

```ts
export interface ConfigProvider {
  init(): Promise<void>;          // 新增，必需
  getConfig(): ResolvedAgentConfig;
  // ...其余不变
}
```

- `DefaultConfigProvider`：构造函数在 `options.paths` 提供时同步加载（`loadConfigFileSync` home 配置 + `mergeEnvConfig` + `initResolver`）；`init()` 保留为接口方法，语义为重新加载。无 `options.paths` 时维持现状（`init()` 内 resolvePaths 后加载）。
- `ChildConfigProvider`（sub-agent）：补 no-op `async init() {}`（parent 已就绪，不可委托——`DefaultConfigProvider.init()` 重跑会覆盖 forWorkspace 合并结果）。
- `StaticConfigProvider`（bridge local）：补 no-op `async init() {}`。
- `agent-context-builder.ts` 中 as-cast 调用改为 `await configProvider.init()`。

### 2. SqliteStorageProvider 构造即就绪（core）

- 构造函数内同步打开 db（`new Database(...)`）+ 执行 schema 迁移 + 创建全部 store 实例。
- `init(): Promise<void>` 保留（`StorageProvider` 接口要求），实现为 no-op。
- 注入自定义 `storageProvider` 的契约：其 store getter 必须构造即可用（文档注明）。

### 3. 装配两阶段化（core）

`agent-context-assembler.ts`：

- `assembleAgentContext(options): AgentAssembly` 改为**同步**。ruleEngine 同步阶段只含 `[defaultRules, profileRules]`；不再调用 `ruleStore.loadAll()`。
- 新增导出 `initRuleEngine(di: AgentDI): Promise<void>`：依次将 `ruleStore.loadAll()` 的 userRules 与 config 的 `sessionRules` 逐条 `addRule` 进 `di.ruleEngine`，最终顺序 `[default, profile, user, session]` 与现状完全一致（`evaluate` 用 `findLast`，后规则优先，顺序必须保持）。permissionEvaluator 持有 ruleEngine 引用，规则后补即可见。
- 移除 `buildRuleSecurity`（拆为内部同步 `buildConfigRules`（不含 sessionRules）+ 导出 `initRuleEngine`），`browser.ts` 导出同步更新。

`agent-context-builder.ts`（Node）：

```ts
export function createAgentAssembly(options?: AgentContextBuildOptions): AgentAssembly;
export async function initAgentAssembly(assembly: AgentAssembly): Promise<void>;
export async function buildAgentContext(options?: AgentContextBuildOptions): Promise<AgentAssembly>;
// = createAgentAssembly + initAgentAssembly，语义不变
```

- `createAgentAssembly`：models、runtime、paths、debug log、configProvider（构造即就绪）、storageProvider 实例、fileMutationQueue、skillProvider、mcpManager、system prompt assembler、toolProvider、`assembleAgentContext`（同步，含 compressor/titleProvider/ruleEngine/permissionEvaluator）。`mcpProviders: []`。
- `initAgentAssembly`：`await di.storage.init()`（注入实现可能真异步；Sqlite 已 no-op）→ `await initRuleEngine(di)` → `di.mcpProviders = await di.mcpManager.connectAll(di.configProvider.getMcpConfig())`。
- `index.ts` 导出 `createAgentAssembly` / `initAgentAssembly` / `initRuleEngine`；`browser.ts` 导出 `initRuleEngine`。

### 4. bridge AgentService

```ts
export class AgentService implements IAgentService {
  private options: AgentServiceOptions;
  private _di: AgentDI;
  private _runtimeConfig: AgentRuntimeConfig;
  private agentState = new AgentState();
  private core: AgentServiceCore;
  private initialized = false;

  constructor(options: AgentServiceOptions) {
    this.options = options;
    const { di, runtimeConfig } = createAgentAssembly(options);
    this._di = di;
    this._runtimeConfig = runtimeConfig;
    this.core = new AgentServiceCore({ di, runtimeConfig, agentState: this.agentState });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await initAgentAssembly({ di: this._di, runtimeConfig: this._runtimeConfig });
    this.initialized = true;
  }

  get di(): AgentDI { return this._di; }              // new 后即可用，不再 undefined
  get runtimeConfig(): AgentRuntimeConfig { return this._runtimeConfig; }
}
```

- `ensureCore` 保留：未 `init()` 调用业务方法仍抛 503（行为不变）。
- `di` / `runtimeConfig` getter 类型去掉 `| undefined`；bridge 测试中 `service.di!` 的 `!` 可清理。

### 5. bridge LocalAgentService 适配（服务层模式不变）

`assembleAgentContext` 变同步 + 用户规则抽离后，`init()` 内适配：

```ts
await storageProvider.init();
const { di, runtimeConfig } = assembleAgentContext({ ... });  // 去 await
await initRuleEngine(di);
this.core = new AgentServiceCore({ di, runtimeConfig, agentState });
```

行为与现状等价（先 db init，再装配，再加载持久化规则）。

## 改动范围

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/core/src/sdk/config-provider.ts` | MODIFY | `ConfigProvider` 新增 `init(): Promise<void>` |
| `packages/core/src/plugins/config/default/index.ts` | MODIFY | 构造函数同步加载配置；`init()` 重加载语义 |
| `packages/core/src/sub-agent/build-child-context.ts` | MODIFY | `ChildConfigProvider` 补 no-op `init()` |
| `packages/core/src/plugins/storage/sqlite/provider.ts` | MODIFY | 构造时同步开库 + 迁移 + 建 store；`init()` no-op |
| `packages/core/src/agent-context-assembler.ts` | MODIFY | `assembleAgentContext` 同步化；新增 `initRuleEngine`；移除 `buildRuleSecurity` |
| `packages/core/src/agent-context-builder.ts` | MODIFY | 拆 `createAgentAssembly` / `initAgentAssembly`；`buildAgentContext` 组合委托；as-cast 消除 |
| `packages/core/src/index.ts` / `browser.ts` | MODIFY | 导出更新 |
| `packages/bridge/src/agent.ts` | MODIFY | 构造函数同步装配 + 创建 core；`init()` 只做异步初始化；getter 去 undefined |
| `packages/bridge/src/local/static-config-provider.ts` | MODIFY | 补 no-op `init()` |
| `packages/bridge/src/local/agent-local-service.ts` | MODIFY | 适配同步 assemble + `initRuleEngine` |
| `packages/core/tests/*` | MODIFY | `tool-pattern-derivation.test.ts` mock 补 `init`；assembler/builder 测试适配同步签名与两阶段；storage 测试适配构造即就绪 |
| `packages/bridge/tests/agent-service/*` | MODIFY | `service.di!` 去 `!`；新增"new 后 di/core 可用、未 init 业务方法 503"断言 |
| `packages/core/README.md` / `AGENTS.md` | MODIFY | 装配入口文档同步 |

## 不改的

- `LocalAgentService` 的服务层模式（仍在 `init()` 内创建 core）。
- `runAgent`、`AgentServiceCore`、子 agent 链路不动。
- 注入 storage/config 的既有调用方（web container、测试）语义不变：`buildAgentContext` 仍是"全做完"的兼容入口。

## 验证

`pnpm typecheck && pnpm test` 全绿。
