# AgentService 构造/init 分离 + ConfigProvider.init 接口化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `new AgentService()` 同步完成 DI 装配并创建 `AgentServiceCore`；`init()` 只做异步资源初始化（storage.init、持久化规则、MCP 连接）；`ConfigProvider` 接口新增必需 `init(): Promise<void>`，消除 as-cast 调用。

**Architecture:** `DefaultConfigProvider` 构造函数同步加载配置 + `SqliteStorageProvider` 构造时同步开库，使 DI 可全同步装配；core builder 拆为 `createAgentAssembly`（同步）/ `initAgentAssembly`（异步）/ `buildAgentContext`（组合，语义不变）；规则引擎同步阶段只含 `[default, profile]`，`initRuleEngine` 在 init 阶段追加 `[user, session]` 保持 `findLast` 求值顺序不变。

**Tech Stack:** TypeScript、pnpm monorepo、vitest。

**Spec:** `docs/superpowers/specs/2026-07-28-agentservice-construct-init-split-design.md`

**验证命令约定：**
- core：`pnpm --filter rem-agent-core typecheck` + `pnpm vitest run packages/core/tests`
- bridge：`pnpm --filter rem-agent-bridge typecheck` + `pnpm vitest run packages/bridge/tests`
- bridge 引用 core 构建产物，core 改公共 API 后须先 `pnpm --filter rem-agent-core build`

---

### Task 1: ConfigProvider.init 接口化 + DefaultConfigProvider 构造同步加载

**Files:**
- Modify: `packages/core/src/sdk/config-provider.ts`
- Modify: `packages/core/src/plugins/config/default/index.ts`
- Modify: `packages/core/src/sub-agent/build-child-context.ts`
- Modify: `packages/core/src/agent-context-builder.ts`
- Modify: `packages/bridge/src/local/static-config-provider.ts`
- Test: `packages/core/tests/tool-pattern-derivation.test.ts`

- [ ] **Step 1: `sdk/config-provider.ts` 接口新增 init**

`ConfigProvider`（第 59-68 行）开头加：

```ts
export interface ConfigProvider {
  /** 初始化/重新加载配置。实现必须保证幂等。 */
  init(): Promise<void>;
  getConfig(): ResolvedAgentConfig;
  // ...其余不变
}
```

- [ ] **Step 2: `DefaultConfigProvider` 构造同步加载**

构造函数（第 40-43 行）替换：

```ts
  constructor(private options: DefaultConfigProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this._paths = options.paths;
    if (this._paths) {
      this.loadSync();
    }
  }

  private loadSync(): void {
    const paths = this._paths as AgentPaths;
    let home: AgentConfig = {};
    const homePath = resolveConfigPaths(paths.homeConfigCandidates())[0];
    if (homePath) {
      home = mergeFileConfig(home, loadConfigFileSync(homePath));
    }
    this.rawHome = home;
    this.raw = mergeEnvConfig(home, this.env);
    this.initResolver();
  }
```

`init()`（第 52-66 行）替换：

```ts
  async init(): Promise<void> {
    if (this._paths) {
      this.loadSync();
      return;
    }
    let home: AgentConfig = {};
    const paths = await this.resolvePaths();
    const homePath = resolveConfigPaths(paths.homeConfigCandidates())[0];
    if (homePath) {
      const homeFile = await loadConfigFile(homePath);
      home = mergeFileConfig(home, homeFile);
    }
    this.rawHome = home;
    this.raw = mergeEnvConfig(home, this.env);
    this.initResolver();
  }
```

（`loadConfigFileSync` 已在第 13 行导入，无需新增 import。）

- [ ] **Step 3: `ChildConfigProvider` 补 no-op init**

`build-child-context.ts` 的 `ChildConfigProvider` 类中（`forWorkspace` 方法前）加：

```ts
  async init(): Promise<void> {
    // 子 agent 的 parent 已初始化；不可委托 parent.init()（DefaultConfigProvider.init 重跑会覆盖 forWorkspace 合并结果）
  }
```

- [ ] **Step 4: `StaticConfigProvider`（bridge）补 no-op init**

`packages/bridge/src/local/static-config-provider.ts` 类中加：

```ts
  async init(): Promise<void> {
    // 配置全部来自构造参数，无需初始化
  }
```

- [ ] **Step 5: 消除 builder 中的 as-cast**

`agent-context-builder.ts` 第 75 行：

```ts
  await configProvider.init();
```

替换 `await (configProvider as { init?: () => Promise<void> }).init?.();`

- [ ] **Step 6: 测试 mock 补 init**

`tool-pattern-derivation.test.ts` 第 5-11 行 `mockConfig` 对象开头加一行：

```ts
const mockConfig: ConfigProvider = {
  init: async () => {},
  getConfig: () => ({} as any),
  // ...其余不变
}
```

- [ ] **Step 7: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests`
Expected: PASS（510 个测试；default-config-provider 测试全部先构造后 `await init()`，构造同步加载不影响断言）

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sdk/config-provider.ts packages/core/src/plugins/config/default/index.ts packages/core/src/sub-agent/build-child-context.ts packages/core/src/agent-context-builder.ts packages/bridge/src/local/static-config-provider.ts packages/core/tests/tool-pattern-derivation.test.ts
git commit -m "feat(core): ConfigProvider.init 接口化，DefaultConfigProvider 构造同步加载"
```

---

### Task 2: SqliteStorageProvider 构造即就绪

**Files:**
- Modify: `packages/core/src/plugins/storage/sqlite/provider.ts`

- [ ] **Step 1: 抽取 open() 并在构造函数调用**

第 25-47 行（constructor + init）替换：

```ts
  constructor(private options: SqliteStorageProviderOptions) {
    this.open();
  }

  private open(): void {
    try {
      mkdirSync(dirname(this.options.dbPath), { recursive: true });
      this.db = new Database(this.options.dbPath);
      this.db.pragma('journal_mode = WAL');
      new SqliteSchemaManager(this.db).migrate();
      this._sessionStore = new SqliteSessionStore(this.db);
      this._ruleStore = new SqliteRuleStore(this.db);
      this._todoStore = new SqliteTodoStore(this.db);
      this._archiveStore = new SqliteArchiveStore(this.db);
      this._workspaceStore = new SqliteWorkspaceStore(this.db);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw wrapSqliteError(
        err,
        'DB_OPEN',
        `Failed to open SQLite database at ${this.options.dbPath}`
      );
    }
  }

  async init(): Promise<void> {
    if (this.db) return;
    this.open();
  }
```

（getter 与 `close()` 不变：`close()` 后 getter 仍抛 'StorageProvider not initialized'，`init()` 可重开。）

- [ ] **Step 2: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests packages/bridge/tests`
Expected: PASS（所有现有调用点都是先 `new` 再 `await init()`，ctor-open 后 init 为 no-op，行为兼容）

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/storage/sqlite/provider.ts
git commit -m "feat(core): SqliteStorageProvider 构造时同步开库，store 构造即可用"
```

---

### Task 3: assembleAgentContext 同步化 + initRuleEngine

**Files:**
- Modify: `packages/core/src/agent-context-assembler.ts`
- Modify: `packages/core/src/browser.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/agent-context-assembler.test.ts`

- [ ] **Step 1: 替换 buildRuleSecurity 为 buildConfigRules + initRuleEngine**

`agent-context-assembler.ts` 第 68-85 行（整个 `buildRuleSecurity`）替换为：

```ts
function buildConfigRules(configProvider: ConfigProvider): Rule[] {
  const config = configProvider.getConfig();
  const profileRules = getProfileRules(config.profile ?? 'coding');
  // 只读 / 状态类工具默认放行。pattern 用 ** 才能跨路径分隔符匹配（派生 pattern 是 file:/abs/path）。
  const defaultRules: Rule[] = [
    { permission: 'read', pattern: '**', action: 'allow', source: 'default' },
    { permission: 'ls', pattern: '**', action: 'allow', source: 'default' },
    { permission: 'session_status', pattern: '*', action: 'allow', source: 'default' },
    { permission: 'todowrite', pattern: '*', action: 'allow', source: 'default' },
  ];
  return [...defaultRules, ...profileRules];
}

/** init 阶段调用：追加持久化 userRules 与 config sessionRules，保持 [default, profile, user, session] 顺序（evaluate 用 findLast，后规则优先）。 */
export async function initRuleEngine(di: AgentDI): Promise<void> {
  const userRules = await di.storage.ruleStore.loadAll();
  const sessionRules = di.configProvider.getConfig().sessionRules ?? [];
  for (const rule of [...userRules, ...sessionRules]) {
    di.ruleEngine.addRule(rule);
  }
}
```

import 清理：第 14 行 `import type { StorageProvider, RuleStorage } from './sdk/storage-provider.js';` 中移除 `RuleStorage`（仅 `buildRuleSecurity` 使用）。

- [ ] **Step 2: assembleAgentContext 同步化**

第 87 行签名替换：

```ts
export function assembleAgentContext(options: AssembleAgentContextOptions): AgentAssembly {
```

第 93 行 `const { ruleEngine } = await buildRuleSecurity(configProvider, storageProvider.ruleStore);` 替换：

```ts
  const ruleEngine = new RuleEngine(buildConfigRules(configProvider));
```

（其余函数体不变。）

- [ ] **Step 3: 导出更新**

`browser.ts` 第 5 行替换：

```ts
export { assembleAgentContext, initRuleEngine } from './agent-context-assembler.js';
```

`index.ts` 在 `export type { AgentAssembly } from './agent-context-assembler.js';` 一行后面加：

```ts
export { initRuleEngine } from './agent-context-assembler.js';
```

- [ ] **Step 4: assembler 测试适配 + 新增 initRuleEngine 用例**

`agent-context-assembler.test.ts`：

`stubOptions` 增加可选入参以支持规则断言（整个函数替换）：

```ts
function stubOptions(overrides?: { userRules?: Rule[]; sessionRules?: Rule[] }): AssembleAgentContextOptions {
  const storage = stubStorageProvider();
  if (overrides?.userRules) {
    storage.ruleStore.loadAll = async () => overrides.userRules!;
  }
  const baseConfigProvider = {
    getConfig: () => ({ profile: 'coding', sessionRules: overrides?.sessionRules ?? [] }),
    getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' }),
    getToolConfig: () => ({}),
    getBehaviorConfig: () => ({ name: 'test', maxTurns: 1 }),
    getCompressionConfig: () => ({ enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 }),
    getMcpConfig: () => ({}),
    resolveAgent: () => ({ id: 'default', name: 'test', corePrompt: '' }),
  };
  return {
    configProvider: baseConfigProvider as never,
    sessionProvider: {
      create: async () => { throw new Error('not used'); },
      load: async () => null,
      save: async () => {},
      delete: async () => {},
      list: async () => [],
      addMessage: () => { throw new Error('not used'); },
      appendContent: () => {},
    },
    storageProvider: storage,
    systemPromptAssembler: { assemble: async () => 'system' },
    models: { getModel: () => undefined, stream: () => { throw new Error('not used'); }, complete: () => { throw new Error('not used'); } } as never,
    runtime: { platform: 'test', env: {} },
    mcpManager: { connectAll: async () => [], closeAll: async () => {} } as never,
  };
}
```

文件头部 import 加：

```ts
import { initRuleEngine } from '../src/agent-context-assembler.js';
import type { Rule } from '../src/security/rules/rule.js';
```

既有用例 `'assembles AgentDI and AgentRuntimeConfig with pure defaults'` 中 `await assembleAgentContext(stubOptions())` 改为同步调用（去 `await`）。

`describe` 末尾新增用例：

```ts
  it('initRuleEngine appends user rules then session rules preserving order', async () => {
    const userRule: Rule = { permission: 'bash', pattern: 'bash:rm *', action: 'deny', source: 'user' };
    const sessionRule: Rule = { permission: 'bash', pattern: 'bash:rm *', action: 'allow', source: 'session' };
    const { di } = assembleAgentContext(stubOptions({ userRules: [userRule], sessionRules: [sessionRule] }));

    const toolCall = { toolName: 'bash', input: undefined, derivedPatterns: ['bash:rm -rf'] };
    expect(di.ruleEngine.evaluate(toolCall)).toBe('ask');

    await initRuleEngine(di);
    expect(di.ruleEngine.evaluate(toolCall)).toBe('allow');
  });
```

- [ ] **Step 5: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent-context-assembler.ts packages/core/src/browser.ts packages/core/src/index.ts packages/core/tests/agent-context-assembler.test.ts
git commit -m "refactor(core): assembleAgentContext 同步化，规则加载拆为 initRuleEngine"
```

---

### Task 4: builder 拆分 createAgentAssembly / initAgentAssembly

**Files:**
- Modify: `packages/core/src/agent-context-builder.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 重写 `agent-context-builder.ts` 的装配部分**

import 区第 13 行后加：

```ts
import { initRuleEngine } from './agent-context-assembler.js';
```

`buildAgentContext`（第 60-124 行）整体替换为三个函数：

```ts
export function createAgentAssembly(options?: AgentContextBuildOptions): AgentAssembly {
  const models = options?.models ?? createCoreModels({ all: true });

  const runtime: AgentRuntimeInfo = options?.runtime ?? {
    platform: process.platform,
    nodeVersion: process.version,
    env: process.env,
  };

  const paths = options?.paths ?? createDefaultAgentPaths();
  configureFileDebugLog(paths.debugLogFile);
  if (paths.debugLogFile && process.env.NODE_ENV === 'development') {
    configureConsoleOutput(true);
  }

  // 注入的 configProvider 必须构造即可读（DefaultConfigProvider 需传 paths）
  const configProvider = options?.configProvider ?? new DefaultConfigProvider({ paths });
  const storageProvider = options?.storageProvider
    ?? new SqliteStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });

  const fileMutationQueue = createFileMutationQueue();
  const skillProvider = options?.skillProvider ?? new FileSkillProvider(configProvider, paths);

  const mcpManager = new McpConnectionManager();

  const templateSelector = new ProviderAwareTemplateSelector(
    new ClaudeAgentPromptTemplate(),
    { openai: new OpenAiAgentPromptTemplate() },
  );

  const defaultAssembler = new DefaultSystemPromptAssembler(
    templateSelector,
    [
      new ToolingSection(),
      new ExecutionBiasSection(),
      new SafetySection(),
      new AgentsMdSection(new ProjectAgentsMdLoader()),
      new SkillsSection(skillProvider),
      new WorkspaceSection(),
      new RuntimeSection(),
    ],
  );

  return assembleAgentContext({
    configProvider,
    sessionProvider: options?.sessionProvider,
    storageProvider,
    systemPromptAssembler: options?.systemPromptAssembler ?? defaultAssembler,
    models,
    runtime,
    mcpManager,
    toolProvider: options?.toolProvider ?? createFileSystemTools(configProvider, fileMutationQueue),
    mcpProviders: options?.mcpProviders,
    skillProvider,
    contextProvider: options?.contextProvider,
    compressor: options?.compressor,
    titleProvider: options?.titleProvider,
    loopStrategy: options?.loopStrategy,
    fileMutationQueue,
    securityMode: options?.securityMode,
  });
}

export async function initAgentAssembly(assembly: AgentAssembly, options?: AgentContextBuildOptions): Promise<void> {
  const { di } = assembly;
  await di.configProvider.init();
  await di.storage.init();
  await initRuleEngine(di);
  if (!options?.mcpProviders) {
    di.mcpProviders = await di.mcpManager.connectAll(di.configProvider.getMcpConfig());
  }
}

export async function buildAgentContext(options?: AgentContextBuildOptions): Promise<AgentAssembly> {
  const assembly = createAgentAssembly(options);
  await initAgentAssembly(assembly, options);
  return assembly;
}
```

（原 `buildAgentContext` 中的 `await configProvider.init()`、`await storageProvider.init()`、`await mcpManager.connectAll(...)` 移入 `initAgentAssembly`；`options?.mcpProviders` 已注入时跳过 connectAll，与原 `??` 语义一致。）

- [ ] **Step 2: index.ts 导出新入口**

第 15 行替换：

```ts
export { buildAgentContext, createAgentAssembly, initAgentAssembly, type AgentContextBuildOptions } from './agent-context-builder.js';
```

- [ ] **Step 3: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests`
Expected: PASS（builder/factory 测试走 `buildAgentContext`，语义不变）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent-context-builder.ts packages/core/src/index.ts
git commit -m "feat(core): builder 拆分 createAgentAssembly / initAgentAssembly 两阶段入口"
```

---

### Task 5: bridge AgentService 构造/init 分离 + LocalAgentService 适配

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Modify: `packages/bridge/src/local/agent-local-service.ts`
- Test: `packages/bridge/tests/agent-service/init.test.ts`
- Test: `packages/bridge/tests/agent-service/session.test.ts`
- Test: `packages/bridge/tests/agent-service/cache-refresh.test.ts`

前置：`pnpm --filter rem-agent-core build`（bridge 引用 core 产物）。

- [ ] **Step 1: 重写 `agent.ts` 的持有与初始化部分**

第 4 行 import 替换：

```ts
import { createAgentAssembly, initAgentAssembly, AgentState } from 'rem-agent-core';
```

类字段与构造函数、init、getter（第 13-42 行）替换：

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
    this.core = new AgentServiceCore({
      di,
      runtimeConfig,
      agentState: this.agentState,
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await initAgentAssembly({ di: this._di, runtimeConfig: this._runtimeConfig }, this.options);

    this.initialized = true;
  }

  get di(): AgentDI {
    return this._di;
  }

  get runtimeConfig(): AgentRuntimeConfig {
    return this._runtimeConfig;
  }

  get state(): AgentState {
    return this.agentState;
  }

  private ensureCore(): AgentServiceCore {
    if (!this.initialized) {
      throw new ServiceError('AgentService not initialized', 503);
    }
    return this.core;
  }
```

（其余委托方法不变。）

- [ ] **Step 2: `agent-local-service.ts` 适配**

- 第 2 行 import 中 `assembleAgentContext` 后加 `initRuleEngine`（同一具名导入列表）
- 第 79 行 `const { di, runtimeConfig } = await assembleAgentContext({` 去掉 `await`
- 第 92 行 `this.core = new AgentServiceCore({ di, runtimeConfig, agentState });` 之前插入一行：

```ts
    await initRuleEngine(di);
```

- [ ] **Step 3: bridge 测试适配**

- `session.test.ts`：第 125、168 行 `service.di!.sessionProvider` → `service.di.sessionProvider`
- `cache-refresh.test.ts`：第 28 行 `const di = service.di!;` → `const di = service.di;`
- `init.test.ts`：`describe` 内新增用例（放在 `'builds AgentDI and runtime config on init'` 之前）：

```ts
  it('exposes di and runtimeConfig right after construction, before init', () => {
    expect(service.di).toBeDefined();
    expect(service.di.sessionProvider).toBeDefined();
    expect(service.runtimeConfig.securityMode).toBe('interactive');
  });
```

（`GUARDED_METHODS` 未 init 抛 503 的用例保持不变——`ensureCore` 仍检查 `initialized`。）

- [ ] **Step 4: 验证**

Run: `pnpm --filter rem-agent-core build && pnpm --filter rem-agent-bridge build && pnpm --filter rem-agent-bridge typecheck && pnpm vitest run packages/bridge/tests`
Expected: PASS（74 个测试 + 新增 1 个）

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/agent.ts packages/bridge/src/local/agent-local-service.ts packages/bridge/tests/agent-service/init.test.ts packages/bridge/tests/agent-service/session.test.ts packages/bridge/tests/agent-service/cache-refresh.test.ts
git commit -m "refactor(bridge): AgentService 构造时同步装配 DI 并创建 core，init 只做异步资源初始化"
```

---

### Task 6: 文档更新与全仓验证

**Files:**
- Modify: `packages/core/README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新 `packages/core/README.md`**

- 第 53 行 `builds the `AgentAssembly` (`{ di, runtimeConfig }`)` 一句后补充分阶段说明：

```markdown
Assembly is two-phase: `createAgentAssembly()` synchronously builds the full `AgentDI` + `AgentRuntimeConfig` (config is loaded in the `DefaultConfigProvider` constructor, SQLite is opened in the `SqliteStorageProvider` constructor); `initAgentAssembly()` then performs async resource initialization (`storage.init()`, persisted rule loading via `initRuleEngine()`, MCP connections). `buildAgentContext()` remains the all-in-one convenience entry.
```

- 第 76-77 行表格 `agent-factory` 行下方加一行：

```markdown
| `agent-context-builder` | `createAgentAssembly()` / `initAgentAssembly()` — two-phase assembly; `buildAgentContext()` = both phases |
```

- [ ] **Step 2: 更新 `AGENTS.md`**

"常用入口"表格中 `packages/core/src/agent-context-assembler.ts` 行下方加一行：

```markdown
| `packages/core/src/agent-context-builder.ts` | `createAgentAssembly`（同步装配）/ `initAgentAssembly`（异步资源初始化）/ `buildAgentContext`（两阶段组合） |
```

并在红线第 1 条 `createAgentFromEnv` 代码块下方补一句：

```markdown
服务宿主（如 bridge `AgentService`）需要构造/init 分离时，改用 `createAgentAssembly` + `initAgentAssembly` 两阶段入口。
```

- [ ] **Step 3: 全仓验证**

Run: `pnpm typecheck && pnpm test`
Expected: PASS（139+ 测试文件全绿）

- [ ] **Step 4: Commit**

```bash
git add packages/core/README.md AGENTS.md
git commit -m "docs: 两阶段装配入口文档同步"
```

---

## Self-Review 记录

- Spec 覆盖：ConfigProvider.init 接口化（Task 1）、Sqlite 构造即就绪（Task 2）、装配两阶段（Task 3/4）、AgentService 分离（Task 5）、LocalAgentService 适配（Task 5 Step 2）、文档（Task 6），与 spec 改动范围表一一对应。
- 顺序保持：Task 3 Step 1 的 `initRuleEngine` 注释与实现保证 `[default, profile, user, session]` 顺序；Task 3 Step 4 新用例显式断言 user→session 覆盖关系。
- 命名一致性：全计划统一 `createAgentAssembly` / `initAgentAssembly` / `initRuleEngine` / `buildConfigRules`（私有）。
- 中间态：Task 1 后 bridge 的 StaticConfigProvider 已同步补齐 init，bridge 全程保持可编译；Task 3 后 browser.ts 导出变更但 LocalAgentService 的 `await` 对同步返回值兼容，Task 5 才彻底适配——bridge 测试在 Task 5 前置 build 后验证。
