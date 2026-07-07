# Provider 显式化创建设计

## 目标

去掉 Provider 动态加载机制，改为显式直接创建。Provider 之间保持独立（已满足），需要 Config 的 Provider 通过构造函数注入 `ConfigProvider`，内部自行提取配置。

## 动机

当前 Provider 系统有三层动态加载机制（`builtinLoaders` → 动态 `import()` → `DefaultProviderLoader` → `AgentProviderRegistry`），引入不必要的复杂度：
- `ProviderModule`、`ProviderLoader`、`ProviderRegistry` 等抽象只服务一个场景（内置 Provider 的延迟加载），没有外部扩展需求
- `ProviderLoaderContext` 中间层把 ConfigProvider 拆成散字段传递，绕过了 ConfigProvider 接口
- `ProviderManager` 作为服务定位器，调用方通过字符串 key 获取 Provider，类型安全性差

## 设计

### 1. 移除的内容

| 移除 | 文件 |
|---|---|
| `builtinLoaders` 映射 + `resolveBuiltinLoader` | `plugins/index.ts`（动态 import 部分，静态导出保留） |
| `DefaultProviderLoader` 类 | `registry/provider-loader.ts` |
| `AgentProviderRegistry` 类 | `registry/provider-registry.ts` |
| `ProviderManager` 类 + `createProviderManager` | `provider-manager.ts` |
| `ProviderKind`、`ProviderLoader`、`ProviderLoaderContext`、`ProviderReference`、`ProviderDescriptor`、`ProviderModule`、`ProviderModuleRef`、`ProviderRegistry`、`BuiltinProviderResolver` | `sdk/provider-loader.ts`（整个文件） |
| 各插件中的 `createProvider` 和 `getDefaultOptions` 导出 | 各插件 `index.ts` |

### 2. 组装入口：`createAgentFromEnv`

`createAgentFromEnv` 是唯一的组装入口，内部硬编码所有默认 Provider 实现，不再接受外部传入 Provider 实例。

```typescript
export interface CreateAgentOptions {
  name?: string;
  configPath?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
}

export async function createAgentFromEnv(options?: CreateAgentOptions) {
  registerBuiltInProviders();

  // 1. ConfigProvider — 唯一的可变入口
  const configProvider = new DefaultConfigProvider({
    configPath: options?.configPath,
    overrides: {
      name: options?.name,
      maxTurns: options?.maxTurns,
      workspaceRoot: options?.workspaceRoot,
      readOnly: options?.readOnly,
      autoApproveDangerous: options?.autoApproveDangerous,
    },
  });
  await configProvider.init();

  const behavior = configProvider.getBehaviorConfig();

  // 2. 所有 Provider 显式创建，需要 Config 的通过构造函数注入
  const sessionProvider = new InMemorySessionProvider();
  const agentLiveProvider = new InMemoryAgentLiveProvider();
  const toolProvider = new FileSystemTools(configProvider);
  const contextProvider = new SimpleContextProvider(configProvider);
  const skillProvider = new FileSkillProvider(configProvider);
  const budgetPolicy = new FixedBudgetPolicy(configProvider);
  const compressor = new NoOpCompressor();
  const errorHandler = new SimpleErrorHandler();
  const titleProvider = new LLMTitleProvider(configProvider);
  const loopStrategy = new ReactLoop();

  // 3. MCP 集成
  const mcpConfig = configProvider.getMcpConfig();
  const mcpManager = new McpConnectionManager();
  const mcpProviders = await mcpManager.connectAll(mcpConfig);
  const effectiveToolProvider = mcpProviders.length > 0
    ? new CompositeToolProvider(toolProvider, mcpProviders)
    : toolProvider;

  // 4. read_skill 工具注册
  effectiveToolProvider.register(
    createReadSkillToolDefinition(),
    createReadSkillToolExecutor(() => skillProvider),
  );

  // 5. 返回
  return {
    configProvider,
    sessionProvider,
    agentLiveProvider,
    toolProvider: effectiveToolProvider,
    contextProvider,
    skillProvider,
    budgetPolicy,
    compressor,
    errorHandler,
    titleProvider,
    loopStrategy,
    mcpManager,
  };
}
```

### 3. `run-agent.ts` 适配

`RunAgentParams` 从 `pm: ProviderManager` 改为 `ctx: AgentContext`：

```typescript
export interface AgentContext {
  configProvider: ConfigProvider;
  sessionProvider: SessionProvider;
  agentLiveProvider: AgentLiveProvider;
  toolProvider: ToolProvider;
  contextProvider: ContextProvider;
  skillProvider?: SkillProvider;
  budgetPolicy: BudgetPolicy;
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider?: TitleProvider;
  loopStrategy: LoopStrategy;
}

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  ctx: AgentContext;
  approvalRegistry?: ApprovalRegistry;
}
```

`runAgent` 内部从 `ctx` 解构使用，不再通过字符串 key 查找。

### 4. Provider 构造函数：ConfigProvider 注入

需要配置的 Provider 改为接收 `ConfigProvider`，内部自行提取：

| Provider | 变更 |
|---|---|
| `SimpleContextProvider` | `new (configProvider)` → 内部调 `getBehaviorConfig().name` |
| `FileSystemTools` | `new (configProvider)` → 内部调 `getBehaviorConfig()` + `getToolConfig()` |
| `FileSkillProvider` | `new (configProvider)` → 内部从 config 获取 `workspaceRoot` 拼路径 |
| `FixedBudgetPolicy` | `new (configProvider)` → 内部调 `getBehaviorConfig().maxTurns` |
| `LLMTitleProvider` | `new (configProvider)` → 内部存引用，`generateTitle` 时自己获取 model 配置 |

不需要 Config 的 Provider 构造函数保持不变：
`InMemorySessionProvider`、`InMemoryAgentLiveProvider`、`NoOpCompressor`、`SimpleErrorHandler`、`ReactLoop`

### 5. Bridge 层适配

`AgentService` 构造函数从 `ProviderManager` 改为直接接收 `SessionProvider` 和 `AgentLiveProvider`（只用到这两个）：

```typescript
constructor(
  private sessionProvider: SessionProvider,
  private agentLiveProvider: AgentLiveProvider,
  workspace = 'default',
) { ... }
```

`runAgent` 调用处传入 `AgentContext` 而非 `pm`。

### 6. 影响范围

| 文件 | 变更 |
|---|---|
| `sdk/provider-loader.ts` | 删除 |
| `registry/provider-loader.ts` | 删除 |
| `registry/provider-registry.ts` | 删除 |
| `provider-manager.ts` | 删除 |
| `plugins/index.ts` | 删除 `builtinLoaders` 和 `resolveBuiltinLoader`，只保留静态导出 |
| `plugins/config/default/index.ts` | 支持 `overrides` 参数合并到配置中 |
| `plugins/context/simple/index.ts`（memory/simple） | 构造函数改为接收 `ConfigProvider` |
| `plugins/tool/file-system/index.ts` | 构造函数改为接收 `ConfigProvider` |
| `plugins/skill/file/index.ts` | 构造函数改为接收 `ConfigProvider` |
| `plugins/budget/fixed/index.ts` | 构造函数改为接收 `ConfigProvider` |
| `plugins/title/llm/index.ts` | 构造函数改为接收 `ConfigProvider` |
| `agent-factory.ts` | 重写为显式组装 |
| `run-agent.ts` | `pm` → `ctx` |
| `sdk/index.ts` | 删除 `provider-loader` 重导出 |
| `bridge/src/agent.ts` | 构造函数适配 |
| `web/src/lib/container.ts` | 适配新的创建方式 |

不改变：
- 所有 SDK 接口文件
- `llm/` 目录
- `mcp/` 目录
- 各 Provider 的核心逻辑
