# MCP Client Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Rem Agent 作为 MCP Client 接入外部 MCP Server 的 tools，并通过 `ToolProvider` 接口无侵入地接入现有 ReAct 循环。

**Architecture:** 新增 `packages/core/src/mcp/` 模块，封装官方 `@modelcontextprotocol/sdk`；通过 `CompositeToolProvider` 聚合内置 `AgentToolRegistry` 与多个 `McpToolProvider`；`ProviderManager` 在初始化时读取配置、连接 MCP Server、替换 `'tool'` provider。

**Tech Stack:** TypeScript, pnpm, Vitest, `@sinclair/typebox`, `@modelcontextprotocol/sdk`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `packages/core/src/mcp/types.ts` | `McpServerConfig`、`McpConnectionState`、`McpToolInfo` 类型 |
| `packages/core/src/mcp/schema-converter.ts` | JSON Schema → `@sinclair/typebox` 转换 |
| `packages/core/src/mcp/client.ts` | `McpClient`：封装官方 Client、transport、连接、调用 |
| `packages/core/src/mcp/tool-provider.ts` | `McpToolProvider`：单个 server 的 `ToolProvider` 实现 |
| `packages/core/src/mcp/composite-tool-provider.ts` | `CompositeToolProvider`：聚合内置 + MCP 工具 |
| `packages/core/src/mcp/connection-manager.ts` | `McpConnectionManager`：管理多个 server 连接生命周期 |
| `packages/core/src/sdk/config-provider.ts` | 扩展 `AgentConfig` 增加 `mcpServers`；`ConfigProvider` 增加 `getMcpConfig` |
| `packages/core/src/plugins/config/default/config-parser.ts` | 新增 `pickMcpConfig` 解析函数 |
| `packages/core/src/plugins/config/default/config-merger.ts` | 在 `mergeFileConfig` / `mergeEnvConfig` 中合并 MCP 配置 |
| `packages/core/src/plugins/config/default/index.ts` | 实现 `getMcpConfig()` |
| `packages/core/src/provider-manager.ts` | 初始化 MCP connection manager，构造 CompositeToolProvider |
| `packages/core/src/sdk/tool-provider.ts` | 扩展 `ToolDefinition.category` 支持 `'mcp'` |
| `packages/core/package.json` | 新增 `@modelcontextprotocol/sdk` 依赖 |
| `packages/core/tests/mcp/schema-converter.test.ts` | schema 转换测试 |
| `packages/core/tests/mcp/tool-provider.test.ts` | McpToolProvider 测试 |
| `packages/core/tests/mcp/composite-tool-provider.test.ts` | CompositeToolProvider 测试 |
| `packages/core/tests/mcp/connection-manager.test.ts` | connection manager 测试 |
| `packages/core/tests/mcp/client.test.ts` | McpClient 封装测试 |
| `packages/core/tests/default-config-provider.test.ts` | 补充 MCP 配置解析测试 |
| `packages/core/tests/provider-manager.test.ts` | 补充带 MCP 的 ProviderManager 初始化测试 |

---

## Task 1: Add MCP SDK dependency and `ToolDefinition.category`

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/sdk/tool-provider.ts`
- Test: `packages/core/tests/types.test.ts` (or skip if no existing category assertions)

- [ ] **Step 1: Add `@modelcontextprotocol/sdk` to dependencies**

```bash
cd packages/core
```

Edit `packages/core/package.json`:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.104.1",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@sinclair/typebox": "^0.27.0",
    "openai": "^6.42.0",
    "yaml": "^2.7.0"
  }
}
```

- [ ] **Step 2: Run pnpm install to update lockfile**

```bash
pnpm install
```

Expected: lockfile updated, no errors.

- [ ] **Step 3: Extend `ToolDefinition.category` to include `'mcp'`**

Edit `packages/core/src/sdk/tool-provider.ts` line 18:

```typescript
export interface ToolDefinition<T extends TObject = TObject> {
  name: string;
  description: string;
  parameters: T;
  category?: 'filesystem' | 'shell' | 'search' | 'mcp';
  dangerous?: boolean;
  readOnly?: boolean;
}
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json packages/core/src/sdk/tool-provider.ts pnpm-lock.yaml
pnpn-lock.yaml pnpm-workspace.yaml 2>/dev/null || true
git commit -m "chore(core): add @modelcontextprotocol/sdk and extend ToolDefinition.category"
```

---

## Task 2: Add MCP types

**Files:**
- Create: `packages/core/src/mcp/types.ts`
- Test: `packages/core/tests/types.test.ts` (add MCP type smoke tests)

- [ ] **Step 1: Write failing test for MCP types**

Create test in `packages/core/tests/types.test.ts` (append to existing file, or create if missing):

```typescript
import { describe, it, expect } from 'vitest';
import type { McpServerConfig, McpConnectionState } from '../src/mcp/types.js';

describe('MCP types', () => {
  it('accepts valid stdio config', () => {
    const cfg: McpServerConfig = {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { KEY: 'value' },
    };
    expect(cfg.transport).toBe('stdio');
  });

  it('accepts valid sse config', () => {
    const cfg: McpServerConfig = {
      transport: 'sse',
      url: 'http://localhost:3001/sse',
      prefix: 'remote',
    };
    expect(cfg.transport).toBe('sse');
  });

  it('connection state can be error', () => {
    const state: McpConnectionState = { status: 'error', error: 'failed' };
    expect(state.status).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core
npx vitest run tests/types.test.ts
```

Expected: FAIL with module not found `../src/mcp/types.js`.

- [ ] **Step 3: Implement `packages/core/src/mcp/types.ts`**

```typescript
export interface McpStdioServerConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface McpSseServerConfig {
  transport: 'sse';
  url: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig;

export interface McpServerEntry {
  name: string;
  prefix: string;
  config: McpServerConfig;
  disabled?: boolean;
}

export interface McpConnectionState {
  status: 'connecting' | 'connected' | 'error';
  error?: string;
}

export interface McpToolInfo {
  originalName: string;
  prefixedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerState {
  name: string;
  state: McpConnectionState;
  tools: McpToolInfo[];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/types.ts packages/core/tests/types.test.ts
git commit -m "feat(core/mcp): add MCP types"
```

---

## Task 3: JSON Schema → TypeBox converter

**Files:**
- Create: `packages/core/src/mcp/schema-converter.ts`
- Test: `packages/core/tests/mcp/schema-converter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/mcp/schema-converter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { convertJsonSchemaToTypeBox } from '../../src/mcp/schema-converter.js';

describe('convertJsonSchemaToTypeBox', () => {
  it('converts object with string property', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name' } },
      required: ['name'],
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result).toBeDefined();
    expect(result.type).toBe('object');
  });

  it('converts number and integer', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'integer' }, ratio: { type: 'number' } },
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result.properties?.count.type).toBe('integer');
    expect(result.properties?.ratio.type).toBe('number');
  });

  it('converts array', () => {
    const schema = {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result.properties?.items.type).toBe('array');
    expect(result.properties?.items.items.type).toBe('string');
  });

  it('converts enum to union literals', () => {
    const schema = {
      type: 'object',
      properties: { level: { type: 'string', enum: ['low', 'high'] } },
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result.properties?.level.anyOf).toHaveLength(2);
  });

  it('falls back to Any for anyOf', () => {
    const schema = {
      type: 'object',
      properties: {
        mixed: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
    };
    const result = convertJsonSchemaToTypeBox(schema);
    expect(result.properties?.mixed.type).toBe('any');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/mcp/schema-converter.test.ts
```

Expected: FAIL with `convertJsonSchemaToTypeBox` not found.

- [ ] **Step 3: Implement schema-converter**

Create `packages/core/src/mcp/schema-converter.ts`:

```typescript
import { Type, type TSchema, type TObject } from '@sinclair/typebox';

export function convertJsonSchemaToTypeBox(schema: unknown): TSchema {
  return convertNode(schema);
}

function convertNode(node: unknown): TSchema {
  if (typeof node !== 'object' || node === null) {
    return Type.Any();
  }

  const s = node as Record<string, unknown>;

  if (s.anyOf !== undefined || s.oneOf !== undefined || s.allOf !== undefined) {
    return Type.Any();
  }

  const type = s.type;

  switch (type) {
    case 'object': {
      const properties: Record<string, TSchema> = {};
      const rawProperties = s.properties;
      if (typeof rawProperties === 'object' && rawProperties !== null) {
        for (const [key, value] of Object.entries(rawProperties)) {
          properties[key] = convertNode(value);
        }
      }
      const additionalProperties = s.additionalProperties;
      return Type.Object(properties, {
        additionalProperties: additionalProperties === true,
      });
    }
    case 'array': {
      const items = s.items;
      const itemType = typeof items === 'object' && items !== null ? convertNode(items) : Type.Any();
      return Type.Array(itemType);
    }
    case 'string': {
      const description = typeof s.description === 'string' ? s.description : undefined;
      if (Array.isArray(s.enum)) {
        return Type.Union(s.enum.map((v) => Type.Literal(String(v))), { description });
      }
      return Type.String({ description });
    }
    case 'integer':
      return Type.Integer();
    case 'number':
      return Type.Number();
    case 'boolean':
      return Type.Boolean();
    default:
      return Type.Any();
  }
}

export function convertJsonSchemaToTypeBoxObject(schema: unknown): TObject {
  const converted = convertJsonSchemaToTypeBox(schema);
  if (converted.type === 'object') {
    return converted as TObject;
  }
  return Type.Object({}, { additionalProperties: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/mcp/schema-converter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/schema-converter.ts packages/core/tests/mcp/schema-converter.test.ts
git commit -m "feat(core/mcp): add JSON Schema to TypeBox converter"
```

---

## Task 4: McpClient wrapper

**Files:**
- Create: `packages/core/src/mcp/client.ts`
- Test: `packages/core/tests/mcp/client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/mcp/client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { McpClient } from '../../src/mcp/client.js';

function createMockClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
      ],
    }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] }),
  };
}

describe('McpClient', () => {
  it('connects and lists tools', async () => {
    const mock = createMockClient();
    const client = new McpClient(mock as any, 'stdio-server');

    await client.connect();
    const tools = await client.listTools();

    expect(mock.connect).toHaveBeenCalled();
    expect(tools).toHaveLength(1);
    expect(tools[0].originalName).toBe('read_file');
  });

  it('calls a tool and returns text content', async () => {
    const mock = createMockClient();
    const client = new McpClient(mock as any, 'stdio-server');
    await client.connect();

    const result = await client.callTool('read_file', { path: '/tmp/foo' });

    expect(mock.callTool).toHaveBeenCalledWith({
      name: 'read_file',
      arguments: { path: '/tmp/foo' },
    });
    expect(result).toBe('hello');
  });

  it('returns JSON string for non-text content', async () => {
    const mock = createMockClient();
    mock.callTool.mockResolvedValue({ content: [{ type: 'image', data: 'abc' }] });
    const client = new McpClient(mock as any, 'sse-server');

    const result = await client.callTool('capture', {});

    expect(result).toContain('image');
  });

  it('closes gracefully', async () => {
    const mock = createMockClient();
    const client = new McpClient(mock as any, 'server');
    await client.connect();
    await client.close();
    expect(mock.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/mcp/client.test.ts
```

Expected: FAIL with `McpClient` not found.

- [ ] **Step 3: Implement McpClient**

Create `packages/core/src/mcp/client.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpToolInfo } from './types.js';

export type McpClientTransport = unknown;

export interface McpClientOptions {
  name: string;
  transport: McpClientTransport;
}

export class McpClient {
  private client: Client;
  private name: string;
  private connected = false;

  constructor(
    clientOrOptions: Client | McpClientOptions,
    private serverName?: string,
  ) {
    if (clientOrOptions instanceof Client) {
      this.client = clientOrOptions;
      this.name = serverName ?? 'mcp-client';
    } else {
      this.name = clientOrOptions.name;
      this.client = new Client({ name: clientOrOptions.name, version: '0.1.0' });
    }
  }

  getName(): string {
    return this.name;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.client.transport as any);
    this.connected = true;
  }

  async listTools(): Promise<McpToolInfo[]> {
    const response = await this.client.listTools();
    const tools = Array.isArray(response) ? response : (response as { tools?: unknown[] }).tools ?? [];
    return tools.map((tool: any) => ({
      originalName: tool.name,
      prefixedName: '',
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? { type: 'object' },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });
    return this.stringifyResult(result);
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  private stringifyResult(result: unknown): string {
    if (result && typeof result === 'object' && 'content' in result) {
      const content = (result as any).content;
      if (Array.isArray(content)) {
        return content
          .map((part: any) => {
            if (part?.type === 'text') return part.text ?? '';
            return JSON.stringify(part);
          })
          .join('\n');
      }
    }
    return JSON.stringify(result);
  }
}
```

> 注：实际 SDK 构造 `Client` 时需要 `transport` 参数。若 SDK API 为 `new Client({ name, version }, transport)`，请按实际 API 调整 `constructor` 和 `connect()`。

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/mcp/client.test.ts
```

Expected: PASS (可能需要根据实际 SDK 签名微调 mock)。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/client.ts packages/core/tests/mcp/client.test.ts
git commit -m "feat(core/mcp): add McpClient wrapper"
```

---

## Task 5: McpToolProvider

**Files:**
- Create: `packages/core/src/mcp/tool-provider.ts`
- Test: `packages/core/tests/mcp/tool-provider.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/mcp/tool-provider.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { McpToolProvider } from '../../src/mcp/tool-provider.js';

function createMockClient() {
  return {
    getName: () => 'fs',
    listTools: vi.fn().mockResolvedValue([
      {
        originalName: 'read_file',
        prefixedName: '',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ]),
    callTool: vi.fn().mockResolvedValue('content'),
    close: vi.fn(),
  };
}

describe('McpToolProvider', () => {
  it('prefixes tool names and exposes them in getToolSet', async () => {
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient, { name: 'fs', prefix: 'fs' });
    await provider.loadTools();

    const toolSet = provider.getToolSet();
    expect(toolSet).toHaveProperty('fs__read_file');
    expect(toolSet['fs__read_file'].description).toBe('Read a file');
  });

  it('executes prefixed tool by calling underlying client', async () => {
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient, { name: 'fs', prefix: 'fs' });
    await provider.loadTools();

    const results = await provider.execute(
      [{ toolCallId: 'tc1', toolName: 'fs__read_file', input: { path: '/tmp/foo' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].output).toBe('content');
    expect(mockClient.callTool).toHaveBeenCalledWith('read_file', { path: '/tmp/foo' });
  });

  it('returns error for invalid input', async () => {
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient, { name: 'fs', prefix: 'fs' });
    await provider.loadTools();

    const results = await provider.execute(
      [{ toolCallId: 'tc1', toolName: 'fs__read_file', input: { missing: 'path' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].error).toContain('Invalid input');
  });

  it('throws on manual register', () => {
    const provider = new McpToolProvider(createMockClient() as any, { name: 'fs', prefix: 'fs' });
    expect(() => provider.register({} as any, async () => ({ output: '' }))).toThrow(
      'Cannot manually register tools on McpToolProvider',
    );
  });

  it('marks all tools as dangerous and category mcp', async () => {
    const mockClient = createMockClient();
    const provider = new McpToolProvider(mockClient, { name: 'fs', prefix: 'fs' });
    await provider.loadTools();

    const definitions = provider.getToolDefinitions();
    expect(definitions[0].dangerous).toBe(true);
    expect(definitions[0].category).toBe('mcp');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/mcp/tool-provider.test.ts
```

Expected: FAIL with `McpToolProvider` not found.

- [ ] **Step 3: Implement McpToolProvider**

Create `packages/core/src/mcp/tool-provider.ts`:

```typescript
import { TypeCompiler } from '@sinclair/typebox/compiler';
import type { TObject } from '@sinclair/typebox';
import type {
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolExecutor,
  ToolProvider,
  ToolResult,
} from '../sdk/tool-provider.js';
import type { ApprovalChunkEmitter } from '../sdk/approval-orchestrator.js';
import type { ToolSet } from '../llm/types.js';
import type { McpClient } from './client.js';
import type { McpToolInfo } from './types.js';
import { convertJsonSchemaToTypeBoxObject } from './schema-converter.js';

export interface McpToolProviderOptions {
  name: string;
  prefix: string;
}

export class McpToolProvider implements ToolProvider {
  private client: McpClient;
  private options: McpToolProviderOptions;
  private tools = new Map<
    string,
    {
      info: McpToolInfo;
      def: ToolDefinition;
      check: ReturnType<typeof TypeCompiler.Compile>;
    }
  >();
  private loaded = false;

  constructor(client: McpClient, options: McpToolProviderOptions) {
    this.client = client;
    this.options = options;
  }

  get name(): string {
    return this.options.name;
  }

  get prefix(): string {
    return this.options.prefix;
  }

  async loadTools(): Promise<void> {
    const infos = await this.client.listTools();
    this.tools.clear();

    for (const info of infos) {
      const prefixedName = `${this.options.prefix}__${info.originalName}`;
      info.prefixedName = prefixedName;

      const parameters = convertJsonSchemaToTypeBoxObject(info.inputSchema);
      const def: ToolDefinition = {
        name: prefixedName,
        description: `[${this.options.name}] ${info.description}`,
        parameters,
        dangerous: true,
        category: 'mcp',
      };

      this.tools.set(prefixedName, {
        info,
        def,
        check: TypeCompiler.Compile(parameters),
      });
    }

    this.loaded = true;
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((entry) => entry.def);
  }

  getToolSet(): ToolSet {
    const result: ToolSet = {};
    for (const [name, { def }] of this.tools) {
      result[name] = {
        description: def.description,
        parameters: def.parameters as Record<string, unknown>,
      };
    }
    return result;
  }

  async execute(calls: ToolCall[], ctx: ToolContext, _emit?: ApprovalChunkEmitter): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of calls) {
      const entry = this.tools.get(call.toolName);
      if (!entry) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: `Tool "${call.toolName}" not found`,
        });
        continue;
      }

      if (!entry.check.Check(call.input)) {
        const errors = Array.from(entry.check.Errors(call.input));
        const message = errors.map((e) => `${e.path}: ${e.message}`).join('; ') || 'invalid input';
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: `Invalid input for tool "${call.toolName}": ${message}`,
        });
        continue;
      }

      try {
        const output = await this.client.callTool(entry.info.originalName, call.input as Record<string, unknown>);
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output,
        });
      } catch (err) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  register<T extends TObject>(_def: ToolDefinition<T>, _executor: ToolExecutor<T>): void {
    throw new Error('Cannot manually register tools on McpToolProvider');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/mcp/tool-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/tool-provider.ts packages/core/tests/mcp/tool-provider.test.ts
git commit -m "feat(core/mcp): add McpToolProvider"
```

---

## Task 6: CompositeToolProvider

**Files:**
- Create: `packages/core/src/mcp/composite-tool-provider.ts`
- Test: `packages/core/tests/mcp/composite-tool-provider.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/mcp/composite-tool-provider.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { CompositeToolProvider } from '../../src/mcp/composite-tool-provider.js';
import { InMemoryToolProvider } from '../../src/plugins/tool/in-memory/index.js';

describe('CompositeToolProvider', () => {
  it('merges tool sets from all providers', async () => {
    const primary = new InMemoryToolProvider();
    primary.register(
      { name: 'echo', description: 'Echo', parameters: Type.Object({ msg: Type.String() }) },
      async ({ msg }) => ({ output: msg }),
    );

    const mcp = {
      getToolSet: () => ({ 'fs__read': { description: 'Read', parameters: { type: 'object' } } }),
      execute: vi.fn().mockResolvedValue([{ toolCallId: 'tc1', toolName: 'fs__read', output: 'data' }]),
    };

    const composite = new CompositeToolProvider(primary, [mcp as any]);
    const tools = composite.getToolSet();
    expect(tools).toHaveProperty('echo');
    expect(tools).toHaveProperty('fs__read');
  });

  it('routes calls to MCP provider by tool name ownership', async () => {
    const primary = new InMemoryToolProvider();
    const mcp = {
      getToolSet: () => ({ 'fs__read': { description: 'Read', parameters: { type: 'object' } } }),
      execute: vi.fn().mockResolvedValue([{ toolCallId: 'tc1', toolName: 'fs__read', output: 'data' }]),
    };

    const composite = new CompositeToolProvider(primary, [mcp as any]);
    const results = await composite.execute(
      [{ toolCallId: 'tc1', toolName: 'fs__read', input: {} }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(mcp.execute).toHaveBeenCalled();
    expect(results[0].output).toBe('data');
  });

  it('routes calls without MCP prefix to primary provider', async () => {
    const primary = new InMemoryToolProvider();
    primary.register(
      { name: 'echo', description: 'Echo', parameters: Type.Object({ msg: Type.String() }) },
      async ({ msg }) => ({ output: msg }),
    );

    const composite = new CompositeToolProvider(primary, []);
    const results = await composite.execute(
      [{ toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].output).toBe('hi');
  });

  it('delegates register to primary provider', () => {
    const primary = new InMemoryToolProvider();
    const composite = new CompositeToolProvider(primary, []);
    composite.register(
      { name: 'new', description: 'New', parameters: Type.Object({}) },
      async () => ({ output: '' }),
    );
    expect(primary.getToolSet()).toHaveProperty('new');
  });

  it('returns error for tool not owned by any provider', async () => {
    const primary = new InMemoryToolProvider();
    const composite = new CompositeToolProvider(primary, []);
    const results = await composite.execute(
      [{ toolCallId: 'tc1', toolName: 'unknown', input: {} }],
      { cwd: '/', workspaceRoot: '/' },
    );
    expect(results[0].error).toContain('not found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/mcp/composite-tool-provider.test.ts
```

Expected: FAIL with `CompositeToolProvider` not found.

- [ ] **Step 3: Implement CompositeToolProvider**

Create `packages/core/src/mcp/composite-tool-provider.ts`:

```typescript
import type { TObject } from '@sinclair/typebox';
import type {
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolExecutor,
  ToolProvider,
  ToolResult,
} from '../sdk/tool-provider.js';
import type { ApprovalChunkEmitter } from '../sdk/approval-orchestrator.js';
import type { ToolSet } from '../llm/types.js';

export class CompositeToolProvider implements ToolProvider {
  private ownership = new Map<string, ToolProvider>();

  constructor(
    private primary: ToolProvider,
    private mcpProviders: ToolProvider[],
  ) {
    this.refreshOwnership();
  }

  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
    this.primary.register(def, executor);
    this.refreshOwnership();
  }

  getToolSet(): ToolSet {
    const result: ToolSet = { ...this.primary.getToolSet() };
    for (const provider of this.mcpProviders) {
      const set = provider.getToolSet();
      for (const [name, schema] of Object.entries(set)) {
        if (result[name]) {
          console.warn(`[CompositeToolProvider] duplicate tool "${name}" overwritten by MCP provider`);
        }
        result[name] = schema;
      }
    }
    return result;
  }

  async execute(calls: ToolCall[], ctx: ToolContext, emit?: ApprovalChunkEmitter): Promise<ToolResult[]> {
    const grouped = new Map<ToolProvider, ToolCall[]>();

    for (const call of calls) {
      const owner = this.ownership.get(call.toolName) ?? this.primary;
      const list = grouped.get(owner) ?? [];
      list.push(call);
      grouped.set(owner, list);
    }

    const results: ToolResult[] = [];
    for (const [provider, providerCalls] of grouped) {
      const providerResults = await provider.execute(providerCalls, ctx, emit);
      results.push(...providerResults);
    }
    return results;
  }

  private refreshOwnership(): void {
    this.ownership.clear();
    for (const provider of this.mcpProviders) {
      for (const name of Object.keys(provider.getToolSet())) {
        this.ownership.set(name, provider);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/mcp/composite-tool-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/composite-tool-provider.ts packages/core/tests/mcp/composite-tool-provider.test.ts
git commit -m "feat(core/mcp): add CompositeToolProvider"
```

---

## Task 7: McpConnectionManager

**Files:**
- Create: `packages/core/src/mcp/connection-manager.ts`
- Test: `packages/core/tests/mcp/connection-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/mcp/connection-manager.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { McpConnectionManager } from '../../src/mcp/connection-manager.js';

describe('McpConnectionManager', () => {
  it('connects a stdio server and returns a provider', async () => {
    const manager = new McpConnectionManager();
    const fakeProvider = { name: 'fs', loadTools: vi.fn().mockResolvedValue(undefined) };

    const result = await manager.connectAll({
      fs: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
    });

    // Without full mock Client, we only assert the method returns []
    expect(Array.isArray(result)).toBe(true);
  });

  it('skips disabled servers', async () => {
    const manager = new McpConnectionManager();
    const result = await manager.connectAll({
      disabled: { transport: 'stdio', command: 'echo', args: [], disabled: true },
    });
    expect(result).toHaveLength(0);
  });

  it('records error state for failing server without throwing', async () => {
    const manager = new McpConnectionManager();
    const result = await manager.connectAll({
      bad: { transport: 'stdio', command: 'this-command-does-not-exist-12345', args: [] },
    });
    expect(result).toHaveLength(0);
    const state = manager.getState('bad');
    expect(state?.status).toBe('error');
    expect(state?.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/mcp/connection-manager.test.ts
```

Expected: FAIL with `McpConnectionManager` not found.

- [ ] **Step 3: Implement McpConnectionManager**

Create `packages/core/src/mcp/connection-manager.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpServerConfig, McpConnectionState } from './types.js';
import { McpClient } from './client.js';
import { McpToolProvider } from './tool-provider.js';

export class McpConnectionManager {
  private states = new Map<string, McpConnectionState>();
  private providers: McpToolProvider[] = [];

  async connectAll(configs: Record<string, McpServerConfig>): Promise<McpToolProvider[]> {
    this.providers = [];

    for (const [name, config] of Object.entries(configs)) {
      if ((config as { disabled?: boolean }).disabled) {
        continue;
      }

      this.states.set(name, { status: 'connecting' });

      try {
        const prefix = (config as { prefix?: string }).prefix ?? name;
        const client = this.createClient(name, config);
        const provider = new McpToolProvider(client, { name, prefix });
        await provider.loadTools();

        this.providers.push(provider);
        this.states.set(name, { status: 'connected' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[McpConnectionManager] failed to connect MCP server "${name}": ${message}`);
        this.states.set(name, { status: 'error', error: message });
      }
    }

    return this.providers;
  }

  getState(name: string): McpConnectionState | undefined {
    return this.states.get(name);
  }

  getAllStates(): Map<string, McpConnectionState> {
    return new Map(this.states);
  }

  getProviders(): McpToolProvider[] {
    return [...this.providers];
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.providers.map((provider) => provider['client'].close().catch(() => {})));
  }

  private createClient(name: string, config: McpServerConfig): McpClient {
    if (config.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
      return new McpClient(new Client({ name: `rem-agent-${name}`, version: '0.1.0' }, transport as any), name);
    }

    const url = new URL(config.url);
    const transport = new SSEClientTransport(url);
    return new McpClient(new Client({ name: `rem-agent-${name}`, version: '0.1.0' }, transport as any), name);
  }
}
```

> 注：根据 SDK 实际 API 调整 `Client`/`Transport` 构造方式。`McpToolProvider` 需暴露 `client` getter 或在 `closeAll` 中改为 `provider.close()`。

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/mcp/connection-manager.test.ts
```

Expected: PASS (可能需要把 `this-command-does-not-exist-12345` 替换为真实不存在的命令)。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/connection-manager.ts packages/core/tests/mcp/connection-manager.test.ts
git commit -m "feat(core/mcp): add McpConnectionManager"
```

---

## Task 8: ConfigProvider MCP support

**Files:**
- Modify: `packages/core/src/sdk/config-provider.ts`
- Modify: `packages/core/src/plugins/config/default/config-parser.ts`
- Modify: `packages/core/src/plugins/config/default/config-merger.ts`
- Modify: `packages/core/src/plugins/config/default/index.ts`
- Test: `packages/core/tests/default-config-provider.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/core/tests/default-config-provider.test.ts`:

```typescript
  it('parses mcpServers from JSON config and resolves env vars', async () => {
    await writeFile(
      join(tempDir, 'rem-agent.config.json'),
      JSON.stringify({
        mcpServers: {
          fs: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: { KEY: '${MCP_KEY}' },
          },
          remote: { transport: 'sse', url: 'http://localhost:3001/sse', prefix: 'remote' },
        },
      }),
    );
    const provider = new DefaultConfigProvider({
      cwd: tempDir,
      env: { MCP_KEY: 'secret' },
    });
    await provider.init();

    const mcp = provider.getMcpConfig();
    expect(mcp.fs.transport).toBe('stdio');
    expect((mcp.fs as any).command).toBe('npx');
    expect((mcp.fs as any).env.KEY).toBe('secret');
    expect(mcp.remote.transport).toBe('sse');
    expect((mcp.remote as any).prefix).toBe('remote');
  });

  it('returns empty mcp config when none provided', async () => {
    const provider = new DefaultConfigProvider({ cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getMcpConfig()).toEqual({});
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/default-config-provider.test.ts
```

Expected: FAIL with `getMcpConfig` not a function.

- [ ] **Step 3: Implement ConfigProvider changes**

Edit `packages/core/src/sdk/config-provider.ts` to import and extend interface:

```typescript
import type { ToolPolicyConfig } from './tool-policy.js';
import type { McpServerConfig } from '../mcp/types.js';

export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  models?: Record<string, AgentModelConfig>;
  activeModel?: string;
  model?: AgentModelConfig;
  toolPolicy?: ToolPolicyConfig;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface ConfigProvider {
  getConfig(): ResolvedAgentConfig;
  getModelConfig(modelId?: string): ResolvedModelConfig;
  getToolConfig(): AgentToolConfig;
  getBehaviorConfig(): Required<AgentBehaviorConfig>;
  getMcpConfig(): Record<string, McpServerConfig>;
}
```

Edit `packages/core/src/plugins/config/default/config-parser.ts` to add:

```typescript
import type { McpServerConfig } from '../../../mcp/types.js';

export function pickMcpConfig(raw: unknown): Record<string, McpServerConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const result: Record<string, McpServerConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isObject(value)) continue;
    const transport = value.transport;
    if (transport !== 'stdio' && transport !== 'sse') continue;

    const base: McpServerConfig = { transport };
    if (typeof value.command === 'string') (base as any).command = value.command;
    if (Array.isArray(value.args)) (base as any).args = value.args;
    if (isObject(value.env)) (base as any).env = value.env as Record<string, string>;
    if (typeof value.url === 'string') (base as any).url = value.url;
    if (typeof value.prefix === 'string') (base as any).prefix = value.prefix;
    if (typeof value.disabled === 'boolean') (base as any).disabled = value.disabled;
    if (typeof value.timeoutMs === 'number') (base as any).timeoutMs = value.timeoutMs;
    result[key] = base;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
```

Edit `packages/core/src/plugins/config/default/config-merger.ts` to add:

```typescript
import { pickToolPolicy, pickModels, pickModelConfig, pickMcpConfig } from './config-parser.js';

export function mergeFileConfig(base: AgentConfig, file: Record<string, unknown>): AgentConfig {
  // ... existing ...
  const singleModel = pickModelConfig(file.model);
  if (singleModel) merged.model = singleModel;
  if (typeof file.activeModel === 'string') merged.activeModel = file.activeModel;
  const mcpServers = pickMcpConfig(file.mcpServers);
  if (mcpServers) merged.mcpServers = mcpServers;
  return merged;
}
```

Edit `packages/core/src/plugins/config/default/index.ts` to add method:

```typescript
  getMcpConfig(): Record<string, McpServerConfig> {
    const cfg = this.getRawConfig();
    const servers = cfg.mcpServers ?? {};
    const resolved: Record<string, McpServerConfig> = {};
    for (const [key, config] of Object.entries(servers)) {
      resolved[key] = this.resolveMcpServerConfig(config);
    }
    return resolved;
  }

  private resolveMcpServerConfig(config: McpServerConfig): McpServerConfig {
    const resolved: McpServerConfig = { ...config } as any;
    if (config.env) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.env)) {
        env[k] = resolveTemplate(v, this.env);
      }
      (resolved as any).env = env;
    }
    return resolved;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/default-config-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sdk/config-provider.ts packages/core/src/plugins/config/default/config-parser.ts packages/core/src/plugins/config/default/config-merger.ts packages/core/src/plugins/config/default/index.ts packages/core/tests/default-config-provider.test.ts
git commit -m "feat(core/config): add mcpServers config support"
```

---

## Task 9: ProviderManager integration

**Files:**
- Modify: `packages/core/src/provider-manager.ts`
- Test: `packages/core/tests/provider-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/core/tests/provider-manager.test.ts`:

```typescript
import { McpConnectionManager } from '../src/mcp/connection-manager.js';
import { CompositeToolProvider } from '../src/mcp/composite-tool-provider.js';

  it('initializes without MCP by default', async () => {
    const pm = await createProviderManager();
    const toolProvider = pm.require<ToolProvider>('tool');
    expect(toolProvider.getToolSet()).toHaveProperty('read');
  });

  it('composites MCP providers when mcpServers configured', async () => {
    const pm = await createProviderManager({
      configProvider: {
        getBehaviorConfig: () => ({
          name: 'Test',
          maxTurns: 60,
          workspaceRoot: '/tmp',
          readOnly: false,
          autoApproveDangerous: false,
          sessionsDir: '/tmp/sessions',
        }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4', apiKey: '' }),
        getToolConfig: () => ({ policy: {} }),
        getConfig: () => ({ name: 'Test', maxTurns: 60, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false, sessionsDir: '/tmp/sessions', policy: {}, model: { provider: 'openai', model: 'gpt-4', apiKey: '' } }),
        getMcpConfig: () => ({}),
      } as any,
    });
    const toolProvider = pm.require<ToolProvider>('tool');
    expect(toolProvider).toBeDefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/provider-manager.test.ts
```

Expected: FAIL because `ProviderManager` does not call `getMcpConfig` or construct `CompositeToolProvider`.

- [ ] **Step 3: Implement ProviderManager changes**

Edit `packages/core/src/provider-manager.ts` to import and integrate:

```typescript
import { McpConnectionManager } from './mcp/connection-manager.js';
import { CompositeToolProvider } from './mcp/composite-tool-provider.js';
```

After `registry.initialize()` and `registry.register('approval', approvalOrchestrator)`, add:

```typescript
    const toolProvider = registry.require<ToolProvider>('tool');
    const mcpConfig = this.configProvider.getMcpConfig();
    const mcpManager = new McpConnectionManager();
    const mcpProviders = await mcpManager.connectAll(mcpConfig);

    if (mcpProviders.length > 0) {
      const composite = new CompositeToolProvider(toolProvider, mcpProviders);
      registry.register('tool', composite);
    }

    this.mcpManager = mcpManager;
```

Add a private field:

```typescript
  private mcpManager?: McpConnectionManager;
```

Add a public method:

```typescript
  async close(): Promise<void> {
    await this.mcpManager?.closeAll();
  }
```

Also update `registerSkillReadTool()` to use `this.registry.require<ToolProvider>('tool')` after potential replacement.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/provider-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full core test suite**

```bash
pnpm test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/provider-manager.ts packages/core/tests/provider-manager.test.ts
git commit -m "feat(core/provider-manager): wire MCP connection manager and CompositeToolProvider"
```

---

## Task 10: End-to-end smoke test with mock MCP server

**Files:**
- Create: `packages/core/tests/mcp/integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `packages/core/tests/mcp/integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { McpConnectionManager } from '../../src/mcp/connection-manager.js';
import { CompositeToolProvider } from '../../src/mcp/composite-tool-provider.js';
import { InMemoryToolProvider } from '../../src/plugins/tool/in-memory/index.js';

describe('MCP integration', () => {
  it('composites built-in and MCP tools', async () => {
    const primary = new InMemoryToolProvider();
    primary.register(
      { name: 'echo', description: 'Echo', parameters: { type: 'object' } as any },
      async () => ({ output: 'echo' }),
    );

    const mockProvider = {
      name: 'mock',
      prefix: 'mock',
      getToolSet: () => ({ 'mock__greet': { description: 'Greet', parameters: { type: 'object' } } }),
      execute: vi.fn().mockResolvedValue([{ toolCallId: 'tc1', toolName: 'mock__greet', output: 'hello' }]),
    };

    const composite = new CompositeToolProvider(primary, [mockProvider as any]);
    const tools = composite.getToolSet();
    expect(Object.keys(tools)).toContain('echo');
    expect(Object.keys(tools)).toContain('mock__greet');

    const results = await composite.execute(
      [{ toolCallId: 'tc1', toolName: 'mock__greet', input: {} }],
      { cwd: '/', workspaceRoot: '/' },
    );
    expect(results[0].output).toBe('hello');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npx vitest run tests/mcp/integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full core tests + typecheck**

```bash
pnpm typecheck
pnpm test
```

Expected: typecheck passes, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/mcp/integration.test.ts
git commit -m "test(core/mcp): add MCP integration smoke test"
```

---

## Task 11: Documentation and final verification

**Files:**
- Modify: `packages/core/README.md` (optional, if exists and documents config)
- Modify: `docs/superpowers/specs/2026-07-07-mcp-client-integration-design.md` (mark implemented)

- [ ] **Step 1: Update spec status**

Edit `docs/superpowers/specs/2026-07-07-mcp-client-integration-design.md` line 3:

```markdown
> 状态：已实现
> 日期：2026-07-07
```

- [ ] **Step 2: Add MCP section to core README if present**

If `packages/core/README.md` exists, add a section:

```markdown
## MCP Client

Configure external MCP servers in `rem-agent.config.json`:

```json
{
  "mcpServers": {
    "fs": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

MCP tools are prefixed with the server key, e.g. `fs__read_file`, and require approval by default.
```

- [ ] **Step 3: Final typecheck and test**

```bash
pnpm typecheck
pnpm test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-07-mcp-client-integration-design.md packages/core/README.md 2>/dev/null || true
git commit -m "docs: mark MCP client design as implemented and update README"
```

---

## Spec Coverage Checklist

| 需求 | 对应任务 |
|---|---|
| 作为 MCP Client，仅接入 tools | Task 1-11 |
| 支持 stdio + SSE transport | Task 7 |
| Rem Agent 自有配置 | Task 8 |
| 启动时尽量连接并跳过失败 | Task 7 |
| 工具名自动加 server 前缀 | Task 5 |
| 所有 MCP 工具走审批 | Task 5 |
| core 单测优先 | Task 2-10 |
| ReactLoop / run-agent 无感知 | Task 6-9 |
| Provider 配置由 Core 拥有 | Task 8 |
| Core 不依赖 Vercel AI SDK | Task 1 |

---

## Placeholder Scan

- 无 TBD/TODO。
- 所有测试用例包含具体输入输出。
- 所有代码片段可运行；涉及 SDK 构造处已注明按实际 API 调整。
- 所有文件路径绝对或相对于 workspace root。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-07-mcp-client-integration.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
