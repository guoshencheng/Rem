# Rem Agent MCP Client 接入设计

> 状态：设计已确认，待实现
> 日期：2026-07-07

## 1. 目标与范围

让 Rem Agent 作为 **MCP Client** 接入外部 MCP Server，将其提供的 `tools` 纳入现有 ReAct 循环，扩展 Agent 的工具集。

**在范围内：**

- 通过 `stdio` 与 `sse` 两种 transport 连接 MCP Server。
- 仅接入 MCP `tools`，暂不支持 `resources` / `prompts`。
- 在 `ProviderManager` 初始化时尽量连接所有配置的 MCP Server；单个失败仅跳过该 server。
- 所有 MCP 工具默认走现有审批流程（`dangerous: true`）。
- 工具名自动加 server 前缀，避免与内置工具冲突。

**不在范围内（后续可扩展）：**

- 把 Rem Agent 自身暴露为 MCP Server。
- 动态增删 MCP Server（运行期热更新）。
- MCP `resources` / `prompts` 的读取与注入。

## 2. 关键约束

- 必须遵守项目红线：**Provider 配置由 Core 拥有**，MCP Server 配置通过 `ConfigProvider` 解析。
- Core 不引入 Vercel AI SDK；MCP 依赖使用官方 `@modelcontextprotocol/sdk`。
- 模块拆分遵循 `module-separation-convention`：每个文件职责单一、不超过 200 行。
- `ReactLoop` / `run-agent.ts` 不感知 MCP，只依赖 `ToolProvider` 接口。

## 3. 总体架构

新增 `packages/core/src/mcp/` 模块：

```text
packages/core/src/mcp/
├── types.ts              # McpServerConfig、McpConnectionState 等类型
├── client.ts             # McpClient：封装官方 Client、transport 创建
├── connection-manager.ts # McpConnectionManager：管理多个 server 连接
├── tool-provider.ts      # McpToolProvider：单个 server 的 ToolProvider 实现
├── composite-tool-provider.ts # CompositeToolProvider：聚合内置 + MCP 工具
└── schema-converter.ts   # JSON Schema → TypeBox 转换
```

`ProviderManager` 初始化时：

1. 加载内置 `AgentToolRegistry`（`tool/file-system` 或 `tool/in-memory`）。
2. 读取 `ConfigProvider.getMcpConfig()`，创建 `McpConnectionManager`。
3. 为每个 enabled server 创建 `McpClient` 并连接；成功后生成 `McpToolProvider`。
4. 用 `CompositeToolProvider` 把内置 registry 与所有成功连接的 MCP providers 聚合。
5. 将 Composite 注册为 `'tool'` provider，供 `ReactLoop` 使用。

## 4. 配置格式

在 `AgentConfig` 中新增：

```typescript
export interface McpServerConfig {
  transport: 'stdio' | 'sse';
  command?: string;        // stdio: 可执行文件
  args?: string[];         // stdio: 参数
  env?: Record<string, string>; // stdio/sse 额外环境变量，支持 ${VAR}
  url?: string;            // sse: 端点
  prefix?: string;         // 工具名前缀，默认用 mcpServers 的 key
  disabled?: boolean;
  timeoutMs?: number;      // 调用超时，默认 60000
}

export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  // ... 现有字段
  mcpServers?: Record<string, McpServerConfig>;
}
```

示例 `rem.config.yaml`：

```yaml
mcpServers:
  fs:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/guoshencheng/data"]
    env:
      SOME_KEY: "${SOME_ENV_KEY}"
  remote:
    transport: sse
    url: http://localhost:3001/sse
    prefix: remote
```

`DefaultConfigProvider` 新增 `getMcpConfig(): Record<string, McpServerConfig>`，复用现有 `resolveTemplate` 做环境变量展开。

## 5. 连接生命周期

### 5.1 初始化

`McpConnectionManager` 在 `ProviderManager.init()` 时被创建：

```typescript
class McpConnectionManager {
  async connectAll(configs: Record<string, McpServerConfig>): Promise<McpToolProvider[]>;
  getState(serverName: string): McpConnectionState;
  async closeAll(): Promise<void>;
}
```

对每个 enabled server：

1. 根据 `transport` 创建 `StdioClientTransport`（`command/args/env`）或 `SSEClientTransport`（`url`）。
2. 创建官方 `Client`，调用 `client.connect()`。
3. 调用 `client.listTools()` 缓存工具列表（返回 `{ tools: [...] }`）。
4. 构造 `McpToolProvider(client, serverName, prefix, tools)`；内部维护 `prefixedName → originalName` 映射，用于执行时调用 `client.callTool({ name: originalName, arguments: input })`。

任一步骤失败：捕获异常，记录 warning，该 server 标记为 `error`，不生成 `McpToolProvider`，不影响其他 server。

### 5.2 关闭

`ProviderManager` 在进程退出或 `close` 时调用 `connectionManager.closeAll()`，依次关闭所有 client，避免僵尸子进程。

## 6. 工具名映射与 Schema 转换

### 6.1 工具名

MCP tool 名称映射为：

```text
${prefix}__${originalName}
```

- `prefix` 默认取 `mcpServers` 的 key。
- 可在配置中显式指定 `prefix`。
- 示例：`fs__read_file`、`remote__search`。

### 6.2 Schema 转换

MCP 返回 JSON Schema。`schema-converter.ts` 将其转换为 `@sinclair/typebox` 类型，用于：

1. `TypeCompiler.Compile()` 在本地做入参校验。
2. `ToolSet` 透传给 LLM Provider；OpenAI/Anthropic 适配器再转回 JSON Schema。

转换规则：

| JSON Schema 类型 | TypeBox 对应 |
|---|---|
| `object` | `Type.Object(properties, { additionalProperties })` |
| `array` | `Type.Array(itemType)` |
| `string` | `Type.String({ description })` |
| `integer` | `Type.Integer()` |
| `number` | `Type.Number()` |
| `boolean` | `Type.Boolean()` |
| `enum` | `Type.Union(...literals)` |
| `anyOf` / `oneOf` / 不支持的结构 | 降级为 `Type.Any()` |

降级策略保证调用仍能进行，但校验放宽。

## 7. 安全与审批

对所有 MCP 工具注册时统一设置 `dangerous: true`，并扩展 `ToolDefinition.category` 类型以支持 `'mcp'`：

```typescript
// packages/core/src/sdk/tool-provider.ts
type ToolCategory = 'filesystem' | 'shell' | 'search' | 'mcp';

// MCP 工具注册时
{
  dangerous: true,
  category: 'mcp',
}
```

这样：

- `createDangerousToolHook` 会拦截所有 MCP 工具调用。
- `ApprovalOrchestrator` 发出 `approval-request` chunk，等待用户决策。
- 用户批准后，`McpToolProvider.execute()` 才将调用转发给 MCP Server。
- 用户拒绝则返回 `ToolResult.error` 并附带 `details.audit.approved: false`。

MCP 工具的输入校验失败不会触发审批，直接返回输入错误。

## 8. CompositeToolProvider

`CompositeToolProvider` 实现 `ToolProvider`，对外表现为单一工具集合：

```typescript
class CompositeToolProvider implements ToolProvider {
  constructor(
    private primary: ToolProvider,      // 内置 AgentToolRegistry
    private mcpProviders: McpToolProvider[],
  ) {}

  register(def, executor): void {
    // 注册委托给 primary（内置工具）
    this.primary.register(def, executor);
  }

  getToolSet(): ToolSet {
    // 合并 primary + 所有 MCP 的 ToolSet
  }

  execute(calls, ctx, emit): Promise<ToolResult[]> {
    // 按 toolName 前缀路由到对应 provider
  }
}
```

- `register` 仅作用于内置工具；`McpToolProvider.register` 抛错，提示 MCP 工具由 server 提供，不可手动注册。
- `getToolSet` 合并所有 provider 的 `ToolSet`；MCP provider 返回的工具名已带前缀。若出现同名，后加载覆盖先加载并记录 warning。
- `execute` 通过 `Map<toolName, ToolProvider>` 路由：初始化时每个 provider 上报自己拥有的工具名，Composite 据此分发调用。不依赖字符串切分，避免工具名含 `__` 时冲突。

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| Server 初始化失败 | 记录 warning，标记 `error`，该 server 工具不进入 ToolSet，其他 server 继续 |
| `listTools()` 失败 | 同初始化失败处理 |
| 工具入参校验失败 | 不调用 MCP Server，直接返回 `Invalid input for tool "..."` |
| MCP Server 调用报错 | 错误信息写入 `ToolResult.error`，`output` 为空 |
| Client 连接断开 | 执行时尝试重连一次；仍失败返回错误 |
| 用户拒绝审批 | 返回 `ToolResult.error` + `details.audit.approved: false` |

## 10. 数据流

```text
ProviderManager.init()
  │
  ▼
加载内置 AgentToolRegistry
  │
  ▼
DefaultConfigProvider.getMcpConfig()
  │
  ▼
McpConnectionManager.connectAll()
  │  对每个 enabled server：
  │  ├─ 创建 transport
  │  ├─ client.connect()
  │  ├─ client.listTools()
  │  └─ 生成 McpToolProvider
  │
  ▼
CompositeToolProvider(primary, mcpProviders)
  │
  ▼
注册为 'tool' provider
  │
  ▼
ReactLoop.iterate()
   ├─ toolProvider.getToolSet() → 合并后的 tools
   └─ toolProvider.execute(calls) → 按前缀路由
```

## 11. 依赖

在 `packages/core/package.json` 新增官方 SDK：

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x"
  }
}
```

> 实际安装时按当时最新稳定版锁定；封装层 `McpClient` 会屏蔽 SDK 内部 API 差异。

## 12. 测试策略

测试集中在 `packages/core/tests/mcp/`，不依赖真实子进程：

- `client.test.ts`：用 mock transport + mock `Client` 验证连接、listTools、callTool、close。
- `schema-converter.test.ts`：覆盖 object/string/number/array/enum/anyOf 等转换与降级。
- `composite-tool-provider.test.ts`：验证前缀路由、合并 ToolSet、注册委托、冲突覆盖。
- `mcp-tool-provider.test.ts`：验证工具名前缀、入参校验、转发、错误映射、审批 hook 触发。
- `connection-manager.test.ts`：验证部分 server 失败跳过、状态管理。

## 13. 风险与回退

| 风险 | 缓解 |
|---|---|
| 官方 MCP SDK API 变化 | 封装在 `McpClient`，内部 API 变更只改一处 |
| JSON Schema → TypeBox 转换不完善 | 降级为 `Type.Any()`，保证调用不阻塞 |
| MCP Server 启动慢或挂起 | 配置 `timeoutMs`，超时报错并跳过 |
| 工具名前缀影响 LLM 理解 | 在工具 description 里保留原始 server/tool 信息 |

## 14. 后续可扩展点

- 支持 `resources`：在 `MemoryProvider` 中通过 MCP 读取资源并注入上下文。
- 支持 `prompts`：将 MCP prompt 模板注入系统提示。
- 运行期热重载 MCP Server。
- 按 server 单独配置审批策略（如只读 server 自动审批）。
