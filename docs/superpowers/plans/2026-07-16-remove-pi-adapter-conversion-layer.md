# 彻底移除 pi-adapter 转换层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `packages/core` 中 REM 自建的 `ModelMessage` / `ContentPart` 表示层及 `pi-adapter.ts` 转换层，让 Core 内部完全直接使用 `@earendil-works/pi-ai` 的数据类型。

**Architecture:** 通过统一 `ToolSet = pi.Tool[]`、删除所有 adapter 转换函数、直接构造 pi-ai 消息与工具结果、统一旧 session 错误处理，完成一次性全链路清理。

**Tech Stack:** TypeScript, pnpm, vitest, `@earendil-works/pi-ai`, Next.js 15

---

## File Structure

### 删除
- `packages/core/src/pi-adapter.ts` — 整文件删除，包含 `toPiMessage` / `fromPiMessage` / `toPiTool` / `toPiToolResultMessage` / `fromPiAssistantMessage` / `migrateConversationToPiAi` / `LegacyModelMessage`。
- `packages/core/tests/session-migration.test.ts` — 旧 schema v1 迁移测试已不适用，整文件删除。

### 创建
- `packages/core/src/plugins/session/errors.ts` — 定义 `UnsupportedSessionSchemaError`。

### 修改（Core 实现）
- `packages/core/src/types.ts` — 删除 `ContentPart` / `MessageContent` / `ModelMessage`；`TurnResult.newMessages` 改为 `pi.Message[]`。
- `packages/core/src/sdk/tool-provider.ts` — `ToolSet` 改为 `pi.Tool[]`；`ToolSchema` 保留。
- `packages/core/src/registry/tool-registry.ts` — `getToolSet()` 返回 `pi.Tool[]`。
- `packages/core/src/plugins/tool/in-memory/index.ts` — `getToolSet()` 返回 `pi.Tool[]`。
- `packages/core/src/mcp/tool-provider.ts` — `getToolSet()` 返回 `pi.Tool[]`。
- `packages/core/src/mcp/composite-tool-provider.ts` — 合并多个 `pi.Tool[]`；按 `tool.name` 冲突覆盖。
- `packages/core/src/overlay-tool-provider.ts` — 合并 base `pi.Tool[]` 与 overlay `pi.Tool[]`；按 `tool.name` 冲突覆盖。
- `packages/core/src/tool-composer.ts` — 删除 `composeToolSet()` 函数；`DefaultToolComposer` 返回的 provider 直接提供 `pi.Tool[]`。
- `packages/core/src/run-agent.ts` — 移除 `composeToolSet` import；`piTools = toolProviderWithDelegate.getToolSet()` 直接可用。
- `packages/core/src/reason/reason.ts` — `tools?: ToolSet` 直接透传。
- `packages/core/src/reason/generate.ts` — `tools?: ToolSet` 直接透传；直接返回 `pi.AssistantMessage`。
- `packages/core/src/execute/execute-tools.ts` — 直接构造 `pi.ToolResultMessage`。
- `packages/core/src/plugins/title/llm/index.ts` — `TITLE_TOOL` 改为 `pi.Tool`；直接构造 `pi.Message[]`；从 `AssistantMessage.content` 提取标题。
- `packages/core/src/plugins/compressor/llm-summary/prompt.ts` — `SUMMARY_TOOL_SCHEMA` 改为 `pi.Tool` 并导出 `SUMMARY_TOOL`。
- `packages/core/src/plugins/compressor/llm-summary/index.ts` — 使用 `SUMMARY_TOOL`；从 `AssistantMessage.content` 提取摘要。
- `packages/core/src/plugins/session/base.ts` — 删除 `migrateConversationToPiAi`；schema v1 抛出 `UnsupportedSessionSchemaError`。
- `packages/core/src/plugins/session/sqlite/index.ts` — 同上。
- `packages/core/src/plugins/session/in-memory/index.ts` — 同上。
- `packages/core/src/plugins/session/local/index.ts` — 删除 `cueMessages` / `pullMessages` / `msgCache` / `.msg.json` 逻辑。
- `packages/core/src/sdk/agent-state-provider.ts` — 删除未使用的 `ContentPart` import。
- `packages/core/src/index.ts` — 无需新增修改，但确认 `ModelMessage` / `ContentPart` 不再通过 `types.ts` 导出。

### 修改（Bridge / 测试 / 文档）
- `packages/bridge/src/index.ts` — 停止 re-export `ModelMessage` / `ContentPart`。
- `packages/core/tests/tool-registry.test.ts` — 断言改为数组 find by name。
- `packages/core/tests/in-memory-tool-provider.test.ts` — 同上。
- `packages/core/tests/overlay-tool-provider.test.ts` — mock base 返回 `pi.Tool[]`；断言改为数组。
- `packages/core/tests/mcp/tool-provider.test.ts` — 断言改为数组 find by name。
- `packages/core/tests/mcp/composite-tool-provider.test.ts` — mock 返回 `pi.Tool[]`；断言改为数组。
- `packages/core/tests/mcp/integration.test.ts` — mock 返回 `pi.Tool[]`。
- `packages/core/tests/tool-composer.test.ts` — 断言改为数组。
- `packages/core/tests/tool-composer-interface.test.ts` — mock 返回空数组。
- `packages/core/tests/reason/reason.test.ts` — 确认 `tools` 透传路径与 `AssistantMessage` 返回类型。
- `packages/core/tests/run-agent.test.ts` — mock `getToolSet()` 返回 `pi.Tool[]`。
- `packages/core/tests/run-agent-custom.test.ts` — 同上。
- `packages/core/tests/run-agent-workspace-root.test.ts` — 同上。
- `packages/core/tests/delegate-task-tool.test.ts` — 同上。
- `packages/core/tests/todowrite-registration.test.ts` — mock 返回 `pi.Tool[]`；断言改为数组。
- `packages/core/tests/todowrite-sqlite-integration.test.ts` — mock 返回 `pi.Tool[]`。
- `packages/core/tests/agent-context-builder.test.ts` — 断言改为数组。
- `packages/core/tests/agent-factory.test.ts` — 断言改为数组。
- `packages/core/tests/compressor/llm-summary.test.ts` — 使用 `pi.Message` 替代 `ModelMessage`。
- `packages/core/tests/session.test.ts` — 使用 `pi.Message`；新增 `UnsupportedSessionSchemaError` 回归测试。
- `packages/core/tests/file-session-provider.test.ts` — 同上。
- `packages/core/tests/local-session-provider.test.ts` — 删除 `cueMessages` / `pullMessages` 用例；使用 `pi.Message`；新增 `UnsupportedSessionSchemaError` 回归测试。
- `packages/core/tests/jsonl-session-store.test.ts` — 使用 `pi.Message` 替代 `ModelMessage`（去掉 `id` 字段）。
- `packages/core/tests/simple-memory-provider.test.ts` — 使用 `pi.Message` 替代 `ModelMessage`。
- `packages/core/tests/types.test.ts` — `TurnResult.newMessages` 类型改为 `pi.Message[]`。
- `packages/core/README.md` — 删除 `pi-adapter` 章节；更新 `types` 与 `llm` 描述。
- `AGENTS.md`（项目根目录）— 更新常用入口表，移除 `pi-adapter.ts`；新增 `ToolSet` / `Message` 类型约定。
- `docs/module-reference.md` — 更新 `types.ts` / `session/local/` / `tool-composer` 描述。
- `docs/superpowers/specs/2026-07-15-pi-ai-llm-migration-design.md` — 在 Phase 3 处补充说明本次清理已完成。

---

## Task 1: 基础类型与错误定义清理

**Files:**
- Delete: `packages/core/src/pi-adapter.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/sdk/tool-provider.ts`
- Create: `packages/core/src/plugins/session/errors.ts`
- Test: `packages/core/tests/types.test.ts`

- [ ] **Step 1: 删除 `pi-adapter.ts`**

  Run: `rm packages/core/src/pi-adapter.ts`

  Expected: 文件已删除，仓库中不再存在 `packages/core/src/pi-adapter.ts`。

- [ ] **Step 2: 清理 `packages/core/src/types.ts`**

  删除 `ContentPart` / `MessageContent` / `ModelMessage` 类型，并把 `TurnResult.newMessages` 改为 `Message[]`：

  ```ts
  import type { ApprovalRequest, ApprovalDecision } from './sdk/agent-state-provider.js';
  import type { Message, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai';

  export interface StreamErrorInfo {
    name: string;
    message: string;
    reason?: 'error' | 'aborted';
    stack?: string;
  }

  export interface RemMessage {
    messageId: string;
    message: Message;
    tokenUsage?: Usage;
  }

  export type RemMetaEvent =
    | { type: 'step-start'; step: number }
    | { type: 'step-finish'; step: number }
    | { type: 'message-start'; step: number; messageId: string }
    | { type: 'session-title'; title: string }
    | { type: 'approval-request'; sessionId: string; request: ApprovalRequest }
    | { type: 'approval-resolved'; sessionId: string; approvalId: string; decision: ApprovalDecision | null }
    | { type: 'compress-start'; sessionId: string; estimatedTokens: number; threshold: number }
    | { type: 'compress-end'; sessionId: string; archiveId: string; removedMessageCount: number }
    | { type: 'compress-error'; sessionId: string; error: string }
    | { type: 'finish'; output: AgentOutput }
    | { type: 'error'; error: StreamErrorInfo };

  export type AgentStreamEvent = AssistantMessageEvent | RemMetaEvent;

  export interface UserInput {
    content: string;
    timestamp?: Date;
  }

  export interface AgentOutput {
    content: string;
    completed: boolean;
  }

  export interface AgentStreamStepResult {
    step: number;
    text: string;
    reasoning: string;
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      input: unknown;
      output?: string;
      error?: string;
    }>;
  }

  export interface AgentStream {
    fullStream: AsyncIterable<AgentStreamEvent>;
    text: Promise<string>;
    usage: Promise<Usage>;
    steps: Promise<AgentStreamStepResult[]>;
  }

  export type AgentStatus = 'idle' | 'running' | 'error';

  export interface ToolCallRecord {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: {
      success: boolean;
      output: string;
      error?: string;
      durationMs: number;
    };
    error?: string;
    durationMs: number;
    timestamp: Date;
  }

  export interface TurnResult {
    content: string;
    newMessages: Message[];
    usage: Usage;
  }
  ```

- [ ] **Step 3: 修改 `packages/core/src/sdk/tool-provider.ts`**

  引入 `pi-ai` 的 `Tool` 类型，并把 `ToolSet` 改为 `Tool[]`：

  ```ts
  import type { Tool } from '@earendil-works/pi-ai';
  import type { Static, TObject } from '@sinclair/typebox';
  import type { Rule } from '../security/rules/rule.js';

  export interface ToolSchema {
    description: string;
    parameters: Record<string, unknown>;
  }

  export type ToolSet = Tool[];
  ```

  文件其余部分保持不变。

- [ ] **Step 4: 创建 `packages/core/src/plugins/session/errors.ts`**

  ```ts
  export class UnsupportedSessionSchemaError extends Error {
    constructor(public schemaVersion: number, sessionId: string) {
      super(`Session ${sessionId} uses unsupported schema version ${schemaVersion}. Please migrate or recreate the session.`);
      this.name = 'UnsupportedSessionSchemaError';
    }
  }
  ```

- [ ] **Step 5: 更新 `packages/core/tests/types.test.ts`**

  `TurnResult.newMessages` 使用 `Message[]`：

  ```ts
  import { describe, it, expect } from 'vitest';
  import type { TurnResult } from '../src/types.js';
  import type { Message } from '@earendil-works/pi-ai';
  import type { McpServerConfig, McpConnectionState } from '../src/mcp/types.js';

  describe('TurnResult', () => {
    it('has content and usage', () => {
      const result: TurnResult = {
        content: 'hello',
        newMessages: [],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      expect(result.content).toBe('hello');
    });
  });

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

- [ ] **Step 6: 运行类型检查确认基础改动**

  Run: `pnpm --filter rem-agent-core typecheck`

  Expected: 仍会有大量错误（因为 ToolProvider 栈、reason、session 等还未改），但 `types.ts` 本身不应报 `ModelMessage` 已定义或 `ToolSet` 重复声明类错误。如果此时没有任何错误，说明类型改动未生效，需检查。

- [ ] **Step 7: Commit**

  ```bash
  git add packages/core/src/types.ts packages/core/src/sdk/tool-provider.ts packages/core/src/plugins/session/errors.ts packages/core/tests/types.test.ts
  git rm packages/core/src/pi-adapter.ts
  git commit -m "refactor(core): remove pi-adapter and legacy ModelMessage/ContentPart types"
  ```

---

## Task 2: ToolProvider 全栈改造为 `pi.Tool[]`

**Files:**
- Modify: `packages/core/src/registry/tool-registry.ts`
- Modify: `packages/core/src/plugins/tool/in-memory/index.ts`
- Modify: `packages/core/src/mcp/tool-provider.ts`
- Modify: `packages/core/src/mcp/composite-tool-provider.ts`
- Modify: `packages/core/src/overlay-tool-provider.ts`
- Modify: `packages/core/src/tool-composer.ts`
- Modify: `packages/core/src/run-agent.ts`
- Test: `packages/core/tests/tool-registry.test.ts`
- Test: `packages/core/tests/in-memory-tool-provider.test.ts`
- Test: `packages/core/tests/overlay-tool-provider.test.ts`
- Test: `packages/core/tests/mcp/tool-provider.test.ts`
- Test: `packages/core/tests/mcp/composite-tool-provider.test.ts`
- Test: `packages/core/tests/mcp/integration.test.ts`
- Test: `packages/core/tests/tool-composer.test.ts`
- Test: `packages/core/tests/tool-composer-interface.test.ts`
- Test: `packages/core/tests/run-agent*.test.ts`
- Test: `packages/core/tests/delegate-task-tool.test.ts`
- Test: `packages/core/tests/todowrite*.test.ts`
- Test: `packages/core/tests/agent-context-builder.test.ts`
- Test: `packages/core/tests/agent-factory.test.ts`

- [ ] **Step 1: 修改 `packages/core/src/registry/tool-registry.ts`**

  ```ts
  import type { Tool } from '@earendil-works/pi-ai';
  import { TypeCompiler } from '@sinclair/typebox/compiler';
  import type { TObject } from '@sinclair/typebox';
  import type { ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolCall, ToolResult } from '../sdk/tool-provider.js';
  import type { ToolPolicyConfig } from '../sdk/tool-policy.js';
  import type { ToolSet } from '../sdk/tool-provider.js';
  import { applyToolPolicyPipeline } from '../security/tool-policy-pipeline.js';
  import { WorkspaceOutsideError } from '../security/workspace-root-guard.js';

  export interface AgentToolRegistryOptions {
    workspaceRoot: string;
    readOnly?: boolean;
    policy?: ToolPolicyConfig;
  }

  export class AgentToolRegistry implements ToolProvider {
    private tools = new Map<
      string,
      {
        def: ToolDefinition;
        executor: ToolExecutor;
        check: ReturnType<typeof TypeCompiler.Compile>;
      }
    >();
    private workspaceRoot: string;
    private readOnly: boolean;
    private policy: ToolPolicyConfig;

    constructor(options: AgentToolRegistryOptions) {
      this.workspaceRoot = options.workspaceRoot;
      this.readOnly = options.readOnly ?? false;
      this.policy = options.policy ?? {};
    }

    register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
      this.tools.set(def.name, {
        def: def as unknown as ToolDefinition,
        executor: executor as ToolExecutor,
        check: TypeCompiler.Compile(def.parameters),
      });
    }

    getToolSet(): ToolSet {
      const all = Array.from(this.tools.values()).map((entry) => entry.def);
      const filtered = applyToolPolicyPipeline({
        tools: all,
        readOnly: this.readOnly,
        policy: this.policy,
      });
      return filtered.map((def) => ({
        name: def.name,
        description: def.description,
        parameters: def.parameters as Record<string, unknown>,
      }));
    }

    isDangerous(toolName: string): boolean {
      return this.tools.get(toolName)?.def.dangerous === true;
    }

    getToolDefinition(name: string): ToolDefinition | undefined {
      return this.tools.get(name)?.def;
    }

    async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
      const results: ToolResult[] = [];
      for (const call of calls) {
        const registered = this.tools.get(call.toolName);
        if (!registered) {
          results.push({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: '',
            error: `Tool "${call.toolName}" not found`,
          });
          continue;
        }

        if (!registered.check.Check(call.input)) {
          const errors = Array.from(registered.check.Errors(call.input));
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
          const { output, details } = await registered.executor(call.input as never, ctx);
          results.push({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
            details,
          });
        } catch (err) {
          if (err instanceof WorkspaceOutsideError) {
            throw err;
          }
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
  }
  ```

- [ ] **Step 2: 修改 `packages/core/src/plugins/tool/in-memory/index.ts`**

  ```ts
  import type { Tool } from '@earendil-works/pi-ai';
  import { TypeCompiler } from '@sinclair/typebox/compiler';
  import type { TObject } from '@sinclair/typebox';
  import type { ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolCall, ToolResult } from '../../../sdk/tool-provider.js';
  import type { ToolSet } from '../../../sdk/tool-provider.js';

  export class InMemoryToolProvider implements ToolProvider {
    private tools = new Map<
      string,
      { def: ToolDefinition; executor: ToolExecutor; check: ReturnType<typeof TypeCompiler.Compile> }
    >();

    register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
      this.tools.set(def.name, {
        def: def as unknown as ToolDefinition,
        executor: executor as ToolExecutor,
        check: TypeCompiler.Compile(def.parameters),
      });
    }

    getToolSet(): ToolSet {
      return Array.from(this.tools.values()).map(({ def }) => ({
        name: def.name,
        description: def.description,
        parameters: def.parameters as Record<string, unknown>,
      }));
    }

    isDangerous(toolName: string): boolean {
      return this.tools.get(toolName)?.def.dangerous === true;
    }

    getToolDefinition(name: string): ToolDefinition | undefined {
      return this.tools.get(name)?.def;
    }

    async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
      const results: ToolResult[] = [];
      for (const call of calls) {
        const registered = this.tools.get(call.toolName);
        if (!registered) {
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `Tool "${call.toolName}" not found` });
          continue;
        }

        if (registered.check.Check(call.input)) {
          try {
            const { output, details } = await registered.executor(call.input as never, ctx);
            results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output, details });
          } catch (err) {
            results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: err instanceof Error ? err.message : String(err) });
          }
          continue;
        }

        const errors = Array.from(registered.check.Errors(call.input));
        const message = errors.map((e) => `${e.path}: ${e.message}`).join('; ') || 'invalid input';
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `Invalid input: ${message}` });
      }
      return results;
    }
  }
  ```

- [ ] **Step 3: 修改 `packages/core/src/mcp/tool-provider.ts`**

  ```ts
  import type { Tool } from '@earendil-works/pi-ai';
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
  import type { ToolSet } from '../sdk/tool-provider.js';
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

    constructor(client: McpClient, options: McpToolProviderOptions) {
      this.client = client;
      this.options = options;
    }

    get name(): string { return this.options.name; }
    get prefix(): string { return this.options.prefix; }

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
          info, def,
          check: TypeCompiler.Compile(parameters),
        });
      }
    }

    getToolDefinitions(): ToolDefinition[] {
      return Array.from(this.tools.values()).map((entry) => entry.def);
    }

    getToolSet(): ToolSet {
      return Array.from(this.tools.values()).map(({ def }) => ({
        name: def.name,
        description: def.description,
        parameters: def.parameters as Record<string, unknown>,
      }));
    }

    isDangerous(toolName: string): boolean {
      return this.tools.get(toolName)?.def.dangerous === true;
    }

    getToolDefinition(name: string): ToolDefinition | undefined {
      return this.tools.get(name)?.def;
    }

    async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
      const results: ToolResult[] = [];

      for (const call of calls) {
        const entry = this.tools.get(call.toolName);
        if (!entry) {
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `Tool "${call.toolName}" not found` });
          continue;
        }

        if (!entry.check.Check(call.input)) {
          const errors = Array.from(entry.check.Errors(call.input));
          const message = errors.map((e) => `${e.path}: ${e.message}`).join('; ') || 'invalid input';
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `Invalid input: ${message}` });
          continue;
        }

        try {
          const output = await this.client.callTool(entry.info.originalName, call.input as Record<string, unknown>);
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output });
        } catch (err) {
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: err instanceof Error ? err.message : String(err) });
        }
      }

      return results;
    }

    async close(): Promise<void> { await this.client.close(); }

    register<T extends TObject>(_def: ToolDefinition<T>, _executor: ToolExecutor<T>): void {
      throw new Error('Cannot manually register tools on McpToolProvider');
    }
  }
  ```

- [ ] **Step 4: 修改 `packages/core/src/mcp/composite-tool-provider.ts`**

  ```ts
  import type { Tool } from '@earendil-works/pi-ai';
  import type { TObject } from '@sinclair/typebox';
  import type {
    ToolCall, ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolResult,
  } from '../sdk/tool-provider.js';
  import type { ToolSet } from '../sdk/tool-provider.js';
  import { log } from '../shared/debug-log.js';

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
      const map = new Map<string, Tool>();
      for (const tool of this.primary.getToolSet()) {
        map.set(tool.name, tool);
      }
      for (const provider of this.mcpProviders) {
        for (const tool of provider.getToolSet()) {
          if (map.has(tool.name)) {
            log('tools', 'duplicate tool overwritten by MCP provider', { toolName: tool.name });
          }
          map.set(tool.name, tool);
        }
      }
      return Array.from(map.values());
    }

    isDangerous(toolName: string): boolean {
      const owner = this.ownership.get(toolName) ?? this.primary;
      return owner.isDangerous(toolName);
    }

    getToolDefinition(name: string): ToolDefinition | undefined {
      const owner = this.ownership.get(name) ?? this.primary;
      return owner.getToolDefinition(name);
    }

    async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
      const grouped = new Map<ToolProvider, ToolCall[]>();

      for (const call of calls) {
        const owner = this.ownership.get(call.toolName) ?? this.primary;
        const list = grouped.get(owner) ?? [];
        list.push(call);
        grouped.set(owner, list);
      }

      const results: ToolResult[] = [];
      for (const [provider, providerCalls] of grouped) {
        const providerResults = await provider.execute(providerCalls, ctx);
        results.push(...providerResults);
      }
      return results;
    }

    private refreshOwnership(): void {
      this.ownership.clear();
      for (const provider of this.mcpProviders) {
        for (const tool of provider.getToolSet()) {
          this.ownership.set(tool.name, provider);
        }
      }
    }
  }
  ```

- [ ] **Step 5: 修改 `packages/core/src/overlay-tool-provider.ts`**

  ```ts
  import type { Tool } from '@earendil-works/pi-ai';
  import { TypeCompiler } from '@sinclair/typebox/compiler';
  import type { TObject } from '@sinclair/typebox';
  import type {
    ToolCall,
    ToolContext,
    ToolDefinition,
    ToolExecutor,
    ToolProvider,
    ToolResult,
  } from './sdk/tool-provider.js';
  import type { ToolSet } from './sdk/tool-provider.js';
  import { log } from './shared/debug-log.js';

  export class OverlayToolProvider implements ToolProvider {
    private overlays = new Map<
      string,
      {
        def: ToolDefinition;
        executor: ToolExecutor;
        check: ReturnType<typeof TypeCompiler.Compile>;
      }
    >();

    constructor(private base: ToolProvider) {}

    register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
      this.overlays.set(def.name, {
        def: def as unknown as ToolDefinition,
        executor: executor as ToolExecutor,
        check: TypeCompiler.Compile(def.parameters),
      });
    }

    getToolSet(): ToolSet {
      const map = new Map<string, Tool>();
      for (const tool of this.base.getToolSet()) {
        map.set(tool.name, tool);
      }
      for (const [name, { def }] of this.overlays) {
        if (map.has(name)) {
          log('tools', 'duplicate tool overwritten by overlay', { toolName: name });
        }
        map.set(name, {
          name,
          description: def.description,
          parameters: def.parameters as Record<string, unknown>,
        });
      }
      return Array.from(map.values());
    }

    isDangerous(toolName: string): boolean {
      const overlay = this.overlays.get(toolName);
      if (overlay) return overlay.def.dangerous === true;
      return this.base.isDangerous(toolName);
    }

    getToolDefinition(name: string): ToolDefinition | undefined {
      const overlay = this.overlays.get(name);
      if (overlay) return overlay.def;
      return this.base.getToolDefinition(name);
    }

    async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
      const baseCalls: ToolCall[] = [];
      const overlayCalls: ToolCall[] = [];

      for (const call of calls) {
        if (this.overlays.has(call.toolName)) {
          overlayCalls.push(call);
        } else {
          baseCalls.push(call);
        }
      }

      const results: ToolResult[] = [];
      if (baseCalls.length > 0) {
        results.push(...await this.base.execute(baseCalls, ctx));
      }

      for (const call of overlayCalls) {
        const entry = this.overlays.get(call.toolName)!;
        if (!entry.check.Check(call.input)) {
          const errors = Array.from(entry.check.Errors(call.input));
          const message = errors.map((e) => `${e.path}: ${e.message}`).join('; ') || 'invalid input';
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `Invalid input: ${message}` });
          continue;
        }

        try {
          const { output, details } = await entry.executor(call.input as never, ctx);
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output, details });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: message });
        }
      }

      return results;
    }
  }
  ```

- [ ] **Step 6: 修改 `packages/core/src/tool-composer.ts`**

  ```ts
  import { CompositeToolProvider } from './mcp/composite-tool-provider.js';
  import { OverlayToolProvider } from './overlay-tool-provider.js';
  import { createReadSkillTool } from './plugins/tool/builtin/skill-read.js';
  import type { ToolProvider } from './sdk/tool-provider.js';
  import type { SkillProvider } from './sdk/skill-provider.js';
  import type { ToolComposer } from './sdk/tool-composer.js';

  export class DefaultToolComposer implements ToolComposer {
    compose({ toolProvider, mcpProviders, skillProvider }: {
      toolProvider: ToolProvider;
      mcpProviders: ToolProvider[];
      skillProvider: SkillProvider;
    }): ToolProvider {
      const base = mcpProviders.length > 0
        ? new CompositeToolProvider(toolProvider, mcpProviders)
        : toolProvider;

      const overlay = new OverlayToolProvider(base);
      const readSkillTool = createReadSkillTool(skillProvider);
      overlay.register(readSkillTool.definition, readSkillTool.executor);

      return overlay;
    }
  }
  ```

- [ ] **Step 7: 修改 `packages/core/src/run-agent.ts`**

  删除 `composeToolSet` import，并把 `piTools` 获取改为直接调用：

  ```ts
  import type { Message, Usage } from '@earendil-works/pi-ai';
  import type { UserInput, AgentOutput, AgentStream, AgentStreamEvent } from './types.js';
  import type { PromptBuildContext } from './sdk/system-prompt.js';
  import type { Skill } from './sdk/skill-provider.js';
  import { EventBus } from './events.js';
  import type { Session } from './session.js';
  import type { LoopContext } from './sdk/loop-strategy.js';
  import type { SessionProvider } from './sdk/session-provider.js';
  import type { TitleProvider } from './sdk/title-provider.js';
  import type { ToolCall, ToolResult } from './sdk/tool-provider.js';
  import { AgentEventStreamController } from './stream/agent-event-stream.js';
  import type { AgentContext } from './agent-context.js';
  import type { ArchiveRecord } from './sdk/storage-provider.js';
  import { resolveContextWindow } from './llm/context-window.js';
  import { generateId } from './shared/generate-id.js';
  import { executeTools } from './execute/execute-tools.js';
  import { AgentState } from './agent-state.js';
  import { normalizeUsage, normalizeUsageDetail, type TokenUsageDetail } from './token-usage.js';
  import { log } from './shared/debug-log.js';
  import { OverlayToolProvider } from './overlay-tool-provider.js';
  import {
    createDelegateTaskToolDefinition,
    createDelegateTaskToolExecutor,
  } from './plugins/tool/builtin/delegate-task.js';
  import {
    createTodoWriteToolDefinition,
    createTodoWriteToolExecutor,
  } from './plugins/tool/builtin/todo-write.js';
  ```

  然后定位到原第 192-193 行：

  ```ts
  // 替换前：
  // const toolSet = toolProviderWithDelegate.getToolSet();
  // const piTools = composeToolSet(toolSet);

  // 替换后：
  const piTools = toolProviderWithDelegate.getToolSet();
  ```

  第 194 行及后续保持不变：

  ```ts
  const tools = piTools.map((t) => ({ name: t.name, description: t.description }));
  ```

- [ ] **Step 8: 更新工具 provider 测试断言为数组形式**

  由于篇幅限制，以下给出每个测试文件的关键替换点，其余部分保持现有结构和逻辑。

  **`packages/core/tests/tool-registry.test.ts`**

  把所有 `tools.echo` / `tools.write` / `tools.read` 断言改为：

  ```ts
  const echo = tools.find((t) => t.name === 'echo');
  expect(echo).toBeDefined();
  expect(echo!.description).toBe('Echo');
  // write / read 同理，用 find + 断言 defined / undefined
  ```

  **`packages/core/tests/in-memory-tool-provider.test.ts`**

  ```ts
  const toolSet = provider.getToolSet();
  const echo = toolSet.find((t) => t.name === 'echo');
  expect(echo).toBeDefined();
  expect(echo!.description).toBe('Echo input');
  ```

  **`packages/core/tests/overlay-tool-provider.test.ts`**

  mock base 返回数组：

  ```ts
  import type { ToolSet } from '../src/sdk/tool-provider.js';

  function createBaseProvider(tools: Record<string, { def: ToolDefinition; executor: ToolExecutor }>): ToolProvider {
    return {
      register: () => {},
      getToolSet: () => {
        const result: ToolSet = [];
        for (const [name, { def }] of Object.entries(tools)) {
          result.push({ name, description: def.description, parameters: def.parameters as Record<string, unknown> });
        }
        return result;
      },
      execute: async (calls) => {
        const results = [];
        for (const call of calls) {
          const tool = tools[call.toolName];
          if (!tool) {
            results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: 'not found' });
            continue;
          }
          const { output } = await tool.executor(call.input as never, { cwd: '/', workspaceRoot: '/' });
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output });
        }
        return results;
      },
      isDangerous: (name) => tools[name]?.def.dangerous === true,
    };
  }
  ```

  断言改为：

  ```ts
  const tools = overlay.getToolSet();
  expect(tools.some((t) => t.name === 'echo')).toBe(true);
  expect(base.getToolSet()).toEqual([]);
  ```

  **`packages/core/tests/mcp/tool-provider.test.ts`**

  ```ts
  const toolSet = provider.getToolSet();
  const readFile = toolSet.find((t) => t.name === 'fs__read_file');
  expect(readFile).toBeDefined();
  expect(readFile!.description).toContain('Read a file');
  ```

  **`packages/core/tests/mcp/composite-tool-provider.test.ts`**

  mock MCP 返回数组：

  ```ts
  const mcp = {
    getToolSet: () => [{ name: 'fs__read', description: 'Read', parameters: { type: 'object' } }],
    execute: vi.fn().mockResolvedValue([{ toolCallId: 'tc1', toolName: 'fs__read', output: 'data' }]),
  };
  ```

  断言：

  ```ts
  const tools = composite.getToolSet();
  expect(tools.some((t) => t.name === 'echo')).toBe(true);
  expect(tools.some((t) => t.name === 'fs__read')).toBe(true);
  expect(primary.getToolSet().some((t) => t.name === 'new')).toBe(true);
  ```

  **`packages/core/tests/mcp/integration.test.ts`**

  mock MCP 返回数组：

  ```ts
  const mockProvider = {
    name: 'mock',
    prefix: 'mock',
    getToolSet: () => [{ name: 'mock__greet', description: 'Greet', parameters: { type: 'object' } }],
    execute: vi.fn().mockResolvedValue([{ toolCallId: 'tc1', toolName: 'mock__greet', output: 'hello' }]),
  };
  ```

  断言改为 `tools.some((t) => t.name === '...')`。

  **`packages/core/tests/tool-composer.test.ts`**

  把所有 `expect(...).toHaveProperty('xxx')` 改为 `expect(...some((t) => t.name === 'xxx')).toBe(true)`；所有 `not.toHaveProperty` 改为 `not.toBe(true)`。

  **`packages/core/tests/tool-composer-interface.test.ts`**

  ```ts
  import type { ToolSet } from '../src/sdk/tool-provider.js';
  ...
  return { getToolSet: () => [] as ToolSet, execute: async () => [], register: () => {}, isDangerous: () => false };
  ```

- [ ] **Step 9: 更新所有 `getToolSet() => ({})` mock 为返回空数组**

  以下测试文件中的 `toolProvider: { getToolSet: () => ({}), ... }` 或 `getToolSet: () => ({}),` 全部改为 `getToolSet: () => [],`：

  - `packages/core/tests/run-agent.test.ts`
  - `packages/core/tests/run-agent-custom.test.ts`
  - `packages/core/tests/run-agent-workspace-root.test.ts`
  - `packages/core/tests/delegate-task-tool.test.ts`
  - `packages/core/tests/todowrite-registration.test.ts`
  - `packages/core/tests/todowrite-sqlite-integration.test.ts`
  - `packages/core/tests/agent-context-builder.test.ts`
  - `packages/core/tests/agent-factory.test.ts`

  在 `packages/core/tests/run-agent.test.ts` 中，还有 `composedToolSet` 对象：

  ```ts
  // 替换前
  const composedToolSet = { composedTool: { description: 'composed', parameters: { type: 'object', properties: {} } } };
  const compose = vi.fn(() => ({
    getToolSet: () => composedToolSet,
    ...
  }));

  // 替换后
  const composedToolSet = [{ name: 'composedTool', description: 'composed', parameters: { type: 'object', properties: {} } }];
  const compose = vi.fn(() => ({
    getToolSet: () => composedToolSet,
    ...
  }));
  ```

  在 `packages/core/tests/todowrite-registration.test.ts` 中，base provider 的第二个 mock 返回对象：

  ```ts
  // 替换前
  getToolSet: () => ({ bash: { description: 'run shell', parameters: {} } }),

  // 替换后
  getToolSet: () => [{ name: 'bash', description: 'run shell', parameters: {} }],
  ```

  以及 `toolSet` 断言和 `tools` 映射：

  ```ts
  expect(toolSet.map((t) => t.name).sort()).toEqual(['bash', 'todowrite']);
  expect(toolSet.find((t) => t.name === 'todowrite')!.description).toMatch(/todo/i);
  const tools = toolSet.map((t) => ({ name: t.name, description: t.description }));
  ```

  在 `packages/core/tests/agent-context-builder.test.ts` 和 `packages/core/tests/agent-factory.test.ts` 中：

  ```ts
  expect(ctx.toolProvider.getToolSet().some((t) => t.name === 'read_skill')).toBe(false);
  ```

- [ ] **Step 10: 运行工具相关测试**

  Run: `pnpm --filter rem-agent-core test -- tests/tool-registry.test.ts tests/in-memory-tool-provider.test.ts tests/overlay-tool-provider.test.ts tests/mcp tests/tool-composer tests/todowrite-registration.test.ts tests/todowrite-sqlite-integration.test.ts tests/agent-context-builder.test.ts tests/agent-factory.test.ts`

  Expected: 全部通过（reason/generate/session/run-agent 可能仍有失败，但工具栈本身通过）。

- [ ] **Step 11: Commit**

  ```bash
  git add packages/core/src/registry/tool-registry.ts packages/core/src/plugins/tool/in-memory/index.ts packages/core/src/mcp/tool-provider.ts packages/core/src/mcp/composite-tool-provider.ts packages/core/src/overlay-tool-provider.ts packages/core/src/tool-composer.ts packages/core/src/run-agent.ts
  git add packages/core/tests/tool-registry.test.ts packages/core/tests/in-memory-tool-provider.test.ts packages/core/tests/overlay-tool-provider.test.ts packages/core/tests/mcp/tool-provider.test.ts packages/core/tests/mcp/composite-tool-provider.test.ts packages/core/tests/mcp/integration.test.ts packages/core/tests/tool-composer.test.ts packages/core/tests/tool-composer-interface.test.ts
  git add packages/core/tests/run-agent.test.ts packages/core/tests/run-agent-custom.test.ts packages/core/tests/run-agent-workspace-root.test.ts packages/core/tests/delegate-task-tool.test.ts packages/core/tests/todowrite-registration.test.ts packages/core/tests/todowrite-sqlite-integration.test.ts packages/core/tests/agent-context-builder.test.ts packages/core/tests/agent-factory.test.ts
  git commit -m "refactor(core): align entire ToolProvider stack with pi.Tool[]"
  ```

---

## Task 3: `reason()` / `generate()` / `execute-tools.ts` 适配

**Files:**
- Modify: `packages/core/src/reason/reason.ts`
- Modify: `packages/core/src/reason/generate.ts`
- Modify: `packages/core/src/execute/execute-tools.ts`
- Test: `packages/core/tests/reason/reason.test.ts`
- Test: `packages/core/tests/execute/execute-tools-*.test.ts`

- [ ] **Step 1: 修改 `packages/core/src/reason/reason.ts`**

  删除 `toPiTool` import，并直接透传 `tools`：

  ```ts
  import type { Message, Models, Context, Usage, ToolCall } from '@earendil-works/pi-ai';
  import type { AgentStreamEvent } from '../types.js';
  import type { ErrorHandler } from '../sdk/error-handler.js';
  import type { ToolSet } from '../sdk/tool-provider.js';
  import { log } from '../shared/debug-log.js';

  export { generate, type GenerateParams } from './generate.js';

  export interface ReasonParams {
    models: Models;
    provider: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
    system: string;
    messages: Message[];
    tools?: ToolSet;
    signal?: AbortSignal;
    errorHandler?: ErrorHandler;
    emit: (event: AgentStreamEvent) => void;
  }

  export interface ReasonResult {
    text: string;
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    reasoning?: string;
    usage: Usage;
    finishReason: string;
  }

  export async function reason(params: ReasonParams): Promise<ReasonResult> {
    const { models } = params;
    const model = models.getModel(params.provider, params.model);
    if (!model) throw new Error(`Unknown model: ${params.provider}/${params.model}`);

    const context: Context = {
      systemPrompt: params.system,
      messages: params.messages,
      tools: params.tools,
    };

    // 其余逻辑保持不变 ...
  }
  ```

- [ ] **Step 2: 修改 `packages/core/src/reason/generate.ts`**

  删除 `fromPiAssistantMessage` 和 `toPiTool` import，`generate()` 直接返回 `AssistantMessage`：

  ```ts
  import type { Message, Models, Context, AssistantMessage } from '@earendil-works/pi-ai';
  import type { ErrorHandler } from '../sdk/error-handler.js';
  import type { ToolSet } from '../sdk/tool-provider.js';
  import { log } from '../shared/debug-log.js';

  export interface GenerateParams {
    models: Models;
    provider: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
    system: string;
    messages: Message[];
    tools?: ToolSet;
    signal?: AbortSignal;
    errorHandler?: ErrorHandler;
    responseFormat?: {
      type: 'json_schema' | 'json_object';
      json_schema?: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };
  }

  export async function generate(params: GenerateParams): Promise<AssistantMessage> {
    const { models } = params;
    const model = models.getModel(params.provider, params.model);
    if (!model) throw new Error(`Unknown model: ${params.provider}/${params.model}`);

    const context: Context = {
      systemPrompt: params.system,
      messages: params.messages,
      tools: params.tools,
    };

    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        log('generate', 'retrying inference', { attempt, provider: params.provider, model: params.model });
      }
      try {
        log('generate', 'inference start', { provider: params.provider, model: params.model, messageCount: params.messages.length });
        const message: AssistantMessage = await models.complete(model, context, {
          apiKey: params.apiKey || undefined,
          baseURL: params.baseURL || undefined,
          signal: params.signal,
          maxRetries: 0,
        });
        if (message.stopReason === 'error' || message.stopReason === 'aborted') {
          throw new Error(message.errorMessage ?? `LLM stopped: ${message.stopReason}`);
        }
        return message;
      } catch (error) {
        const category = params.errorHandler?.classify(error) ?? 'unknown';
        const message = error instanceof Error ? error.message : String(error);
        log('generate', 'inference error', { attempt, provider: params.provider, model: params.model, category, error: message });
        lastError = error;
        if (!params.errorHandler) throw error;
        if (!params.errorHandler.isRetryable(category)) throw error;
        if (attempt === maxAttempts - 1) throw error;
      }
    }

    throw lastError;
  }
  ```

- [ ] **Step 3: 修改 `packages/core/src/execute/execute-tools.ts`**

  删除 `toPiToolResultMessage` import，在循环内直接构造 `ToolResultMessage`：

  ```ts
  import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
  import type { AgentStreamEvent } from '../types.js';
  import type { ToolCall, ToolProvider, ToolResult, ToolContext } from '../sdk/tool-provider.js';
  import type { ToolPermissionEvaluator } from '../security/permissions/types.js';
  import type { SecurityMode } from '../security/permissions/factory.js';
  import type { Rule } from '../security/rules/rule.js';
  import type { RuleStorage } from '../sdk/storage-provider.js';
  import { AgentState } from '../agent-state.js';
  import { RuleEngine } from '../security/rules/rule-engine.js';
  import { WorkspaceOutsideError } from '../security/workspace-root-guard.js';
  import { classifyTool } from '../security/permissions/tool-classifier.js';
  import type { ToolCategory } from '../security/permissions/tool-classifier.js';
  import { log } from '../shared/debug-log.js';
  ```

  替换原第 118-120 行：

  ```ts
  for (const result of results) {
    const toolResultMessage: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      content: [{ type: 'text', text: result.output ?? '' }],
      isError: !!result.error,
      timestamp: Date.now(),
    };
    messages.push(toolResultMessage);
  }
  ```

  文件其余逻辑保持不变。

- [ ] **Step 4: 运行 reason 与 execute 相关测试**

  Run: `pnpm --filter rem-agent-core test -- tests/reason/reason.test.ts tests/execute/`

  Expected: 全部通过。

- [ ] **Step 5: Commit**

  ```bash
  git add packages/core/src/reason/reason.ts packages/core/src/reason/generate.ts packages/core/src/execute/execute-tools.ts
  git commit -m "refactor(core): reason/generate pass pi.Tool[] directly and execute-tools constructs pi.ToolResultMessage"
  ```

---

## Task 4: Title Provider 与 Compressor 适配

**Files:**
- Modify: `packages/core/src/plugins/title/llm/index.ts`
- Modify: `packages/core/src/plugins/compressor/llm-summary/prompt.ts`
- Modify: `packages/core/src/plugins/compressor/llm-summary/index.ts`
- Test: `packages/core/tests/compressor/llm-summary.test.ts`

- [ ] **Step 1: 修改 `packages/core/src/plugins/title/llm/index.ts`**

  ```ts
  import type { Message, Models, Tool, ToolCall } from '@earendil-works/pi-ai';
  import type { TitleProvider } from '../../../sdk/title-provider.js';
  import type { ConfigProvider } from '../../../sdk/config-provider.js';
  import { generate } from '../../../reason/generate.js';

  const TITLE_SYSTEM_PROMPT = `You are a title generator...`; // 保持原有完整 prompt 不变

  const TITLE_TOOL: Tool = {
    name: 'set_title',
    description: 'Set the title for this conversation',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'A brief, concise title (≤50 chars) summarizing the conversation topic',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  };

  export class LLMTitleProvider implements TitleProvider {
    private configProvider: ConfigProvider;
    private models: Models;

    constructor(configProvider: ConfigProvider, models: Models) {
      this.configProvider = configProvider;
      this.models = models;
    }

    async generateTitle(conversation: Message[]): Promise<string | undefined> {
      const userMessages = conversation.filter((m) => m.role === 'user');
      if (userMessages.length === 0) return undefined;

      const modelConfig = this.configProvider.getModelConfig();

      const messages: Message[] = userMessages.map((m) => ({
        role: 'user',
        content: typeof m.content === 'string'
          ? m.content
          : m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' '),
        timestamp: Date.now(),
      }));

      try {
        const result = await generate({
          models: this.models,
          provider: modelConfig.provider,
          model: modelConfig.model,
          apiKey: modelConfig.apiKey || undefined,
          baseURL: modelConfig.baseURL || undefined,
          system: TITLE_SYSTEM_PROMPT,
          messages,
          tools: [TITLE_TOOL],
        });

        const titleCall = result.content
          .filter((b): b is ToolCall => b.type === 'toolCall')
          .find((b) => b.name === 'set_title');
        if (titleCall?.arguments && typeof titleCall.arguments === 'object' && 'title' in titleCall.arguments) {
          const title = String(titleCall.arguments.title).trim().slice(0, 50);
          return title || undefined;
        }
        return undefined;
      } catch {
        return undefined;
      }
    }
  }
  ```

- [ ] **Step 2: 修改 `packages/core/src/plugins/compressor/llm-summary/prompt.ts`**

  把 `SUMMARY_TOOL_SCHEMA` 改名为 `SUMMARY_TOOL` 并改为 `pi.Tool` 类型：

  ```ts
  import type { Message, Tool } from '@earendil-works/pi-ai';

  export const SUMMARY_SYSTEM_PROMPT = `You are a context summarization assistant...`; // 保持完整 prompt

  export const SUMMARY_TOOL_NAME = 'submit_summary';

  export const SUMMARY_TOOL: Tool = {
    name: SUMMARY_TOOL_NAME,
    description: 'Submit a structured summary of the conversation history',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'One or two brief sentences describing what the user is trying to accomplish',
        },
        importantDetails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue',
        },
        completed: {
          type: 'array',
          items: { type: 'string' },
          description: 'Finished work, verified facts, or changes made',
        },
        active: {
          type: 'array',
          items: { type: 'string' },
          description: 'Current work, partial changes, or investigation state',
        },
        blocked: {
          type: 'array',
          items: { type: 'string' },
          description: 'Blockers, failing commands, or unknowns',
        },
        nextMove: {
          type: 'array',
          items: { type: 'string' },
          description: 'Immediate concrete actions, in priority order',
        },
        relevantFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'File or directory paths and why they matter',
        },
      },
      required: ['objective', 'importantDetails', 'completed', 'active', 'blocked', 'nextMove', 'relevantFiles'],
    },
  };

  export interface SummaryData {
    objective: string;
    importantDetails: string[];
    completed: string[];
    active: string[];
    blocked: string[];
    nextMove: string[];
    relevantFiles: string[];
  }

  // buildSummaryPrompt / formatSummaryAsMarkdown / serializeMessages 保持原有实现不变
  ```

- [ ] **Step 3: 修改 `packages/core/src/plugins/compressor/llm-summary/index.ts`**

  ```ts
  import type { Message, Models, ToolCall, TextContent } from '@earendil-works/pi-ai';
  import type { ContextCompressor } from '../../../sdk/compressor.js';
  import type { Session } from '../../../session.js';
  import type { ResolvedModelConfig, CompressionConfig } from '../../../sdk/config-provider.js';
  import type { TokenUsageDetail } from '../../../token-usage.js';
  import { resolveContextWindow } from '../../../llm/context-window.js';
  import { generate } from '../../../reason/generate.js';
  import { splitHeadTail } from './split.js';
  import {
    buildSummaryPrompt,
    SUMMARY_SYSTEM_PROMPT,
    SUMMARY_TOOL_NAME,
    SUMMARY_TOOL,
    formatSummaryAsMarkdown,
    type SummaryData,
  } from './prompt.js';

  export class LLMSummarizingCompressor implements ContextCompressor {
    constructor(
      private config: Required<CompressionConfig>,
      private modelConfig: ResolvedModelConfig,
      private models: Models,
    ) {}

    shouldCompress(session: Session): boolean {
      if (!this.config.enabled) return false;

      const history = (session.metadata.tokenUsageHistory ?? []) as TokenUsageDetail[];
      const accumulated = history.reduce((sum, entry) => sum + entry.totalTokens, 0);
      const offset = (session.metadata.compressionTokenOffset as number) ?? 0;
      const effectiveTokens = accumulated - offset;

      if (effectiveTokens <= 0 && history.length === 0) {
        const totalChars = session.conversation.reduce((sum, msg) => {
          const content = typeof msg.content === 'string' ? [msg.content] : msg.content;
          const text = content
            .filter((p): p is { type: 'text'; text: string } => typeof p === 'object' && p.type === 'text')
            .map((p) => p.text)
            .join('');
          return sum + text.length;
        }, 0);
        const estimated = Math.ceil(totalChars / 4);
        const maxTokens = resolveContextWindow(this.modelConfig.provider, this.modelConfig.model);
        return estimated >= maxTokens * this.config.thresholdRatio;
      }

      const maxTokens = resolveContextWindow(this.modelConfig.provider, this.modelConfig.model);
      const threshold = maxTokens * this.config.thresholdRatio;
      return effectiveTokens >= threshold;
    }

    async compress(messages: Message[]): Promise<Message[]> {
      const { head, middle, tail } = splitHeadTail(
        messages,
        this.config.protectHead,
        this.config.protectTail,
      );

      if (middle.length === 0) {
        return messages;
      }

      const prompt = buildSummaryPrompt(middle);
      const result = await generate({
        models: this.models,
        provider: this.modelConfig.provider,
        model: this.modelConfig.model,
        apiKey: this.modelConfig.apiKey || undefined,
        baseURL: this.modelConfig.baseURL || undefined,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }] as Message[],
        tools: [SUMMARY_TOOL],
      });

      const summaryCall = result.content
        .filter((b): b is ToolCall => b.type === 'toolCall')
        .find((b) => b.name === SUMMARY_TOOL_NAME);
      const summaryData = summaryCall?.arguments as SummaryData | undefined;

      const summaryText = summaryData
        ? formatSummaryAsMarkdown(summaryData)
        : result.content
            .filter((b): b is TextContent => b.type === 'text')
            .map((b) => b.text)
            .join('');

      const summaryMsg: Message = {
        role: 'user',
        content: [{ type: 'text', text: `[上下文压缩摘要]\n\n${summaryText}` }],
        timestamp: Date.now(),
      } as unknown as Message;

      return [...head, summaryMsg, ...tail];
    }
  }
  ```

  注意：`shouldCompress` 保持原有实现不变，但内部已有 `m.content.filter(...)` 逻辑，因 `m.content` 在 `pi.Message` 中为数组或字符串，原有逻辑仍然兼容。

- [ ] **Step 4: 修改 `packages/core/tests/compressor/llm-summary.test.ts`**

  使用 `pi.Message` 替代 `ModelMessage`：

  ```ts
  import { describe, it, expect } from 'vitest';
  import { splitHeadTail } from '../../src/plugins/compressor/llm-summary/split.js';
  import { buildSummaryPrompt } from '../../src/plugins/compressor/llm-summary/prompt.js';
  import type { Message } from '@earendil-works/pi-ai';

  function makeMsg(role: Message['role'], text: string): Message {
    return { role, content: [{ type: 'text', text }], timestamp: Date.now() };
  }

  describe('splitHeadTail', () => {
    it('splits messages into head, middle, tail', () => {
      const msgs = Array.from({ length: 30 }, (_, i) => makeMsg('user', `msg ${i}`));
      const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
      expect(head).toHaveLength(3);
      expect(middle).toHaveLength(7);
      expect(tail).toHaveLength(20);
      expect(head[0].content).toEqual([{ type: 'text', text: 'msg 0' }]);
      expect(tail[19].content).toEqual([{ type: 'text', text: 'msg 29' }]);
    });

    it('returns all as head when too short', () => {
      const msgs = Array.from({ length: 5 }, (_, i) => makeMsg('user', `msg ${i}`));
      const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
      expect(head).toHaveLength(5);
      expect(middle).toHaveLength(0);
      expect(tail).toHaveLength(0);
    });

    it('handles exact boundary', () => {
      const msgs = Array.from({ length: 23 }, (_, i) => makeMsg('user', `msg ${i}`));
      const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
      expect(head).toHaveLength(3);
      expect(middle).toHaveLength(0);
      expect(tail).toHaveLength(20);
    });
  });

  describe('buildSummaryPrompt', () => {
    it('includes tool instruction and serialized messages', () => {
      const middle = [
        makeMsg('user', 'help me refactor'),
        makeMsg('assistant', 'sure, I will read the file'),
      ];
      const prompt = buildSummaryPrompt(middle);
      expect(prompt).toContain('submit_summary');
      expect(prompt).toContain('[User]: help me refactor');
      expect(prompt).toContain('[Assistant]: sure, I will read the file');
    });
  });
  ```

- [ ] **Step 5: 运行 compressor 与 title 相关测试**

  Run: `pnpm --filter rem-agent-core test -- tests/compressor/llm-summary.test.ts`

  Expected: 全部通过。

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core/src/plugins/title/llm/index.ts packages/core/src/plugins/compressor/llm-summary/prompt.ts packages/core/src/plugins/compressor/llm-summary/index.ts packages/core/tests/compressor/llm-summary.test.ts
  git commit -m "refactor(core): title and compressor use pi.Tool[] and consume AssistantMessage directly"
  ```

---

## Task 5: Session Provider 清理与统一错误处理

**Files:**
- Modify: `packages/core/src/plugins/session/base.ts`
- Modify: `packages/core/src/plugins/session/sqlite/index.ts`
- Modify: `packages/core/src/plugins/session/in-memory/index.ts`
- Modify: `packages/core/src/plugins/session/local/index.ts`
- Test: `packages/core/tests/session.test.ts`
- Test: `packages/core/tests/file-session-provider.test.ts`
- Test: `packages/core/tests/local-session-provider.test.ts`
- Delete: `packages/core/tests/session-migration.test.ts`

- [ ] **Step 1: 修改 `packages/core/src/plugins/session/base.ts`**

  ```ts
  import { randomUUID } from 'crypto';
  import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
  import type { Session, SessionProvider, SessionSummary } from '../../sdk/session-provider.js';
  import type { RemMessage } from '../../types.js';
  import { JsonlSessionStore } from './jsonl-store.js';
  import { UnsupportedSessionSchemaError } from './errors.js';

  export abstract class BaseSessionProvider implements SessionProvider {
    protected store: JsonlSessionStore;

    constructor(dir: string) {
      this.store = new JsonlSessionStore(dir);
    }

    async create(): Promise<Session> {
      const now = new Date();
      const session: Session = {
        sessionId: randomUUID(),
        conversation: [],
        currentTurn: 0,
        metadata: { schemaVersion: 2 },
        createdAt: now,
        updatedAt: now,
      };
      await this.store.save(session);
      return session;
    }

    async load(sessionId: string): Promise<Session | null> {
      const session = await this.store.load(sessionId);
      if (!session) return null;

      const schemaVersion = session.metadata?.schemaVersion ?? 1;
      if (schemaVersion < 2) {
        throw new UnsupportedSessionSchemaError(schemaVersion, sessionId);
      }

      return session;
    }

    addMessage(session: Session, role: 'assistant' | 'tool'): RemMessage {
      const messageId = randomUUID();
      let message: Message;
      if (role === 'assistant') {
        message = { role: 'assistant', content: [], timestamp: Date.now() } as unknown as Message;
      } else {
        message = { role: 'toolResult', toolCallId: '', toolName: '', content: [], isError: false, timestamp: Date.now() } as unknown as Message;
      }
      session.conversation.push(message);
      const messageMeta = (session.metadata.messageMeta ?? {}) as Record<string, string>;
      messageMeta[messageId] = messageId;
      session.metadata = { ...session.metadata, messageMeta };
      void this.save(session).catch(() => {});
      return { messageId, message };
    }

    appendContent(session: Session, message: Message, block: TextContent | ThinkingContent | ToolCall): void {
      (message.content as unknown[]).push(block);
      void this.save(session).catch(() => {});
    }

    async save(session: Session): Promise<void> {
      await this.store.save(session);
    }

    async delete(sessionId: string): Promise<void> {
      await this.store.delete(sessionId);
    }

    abstract list(): Promise<SessionSummary[]>;
  }
  ```

- [ ] **Step 2: 修改 `packages/core/src/plugins/session/sqlite/index.ts`**

  ```ts
  import { randomUUID } from 'node:crypto';
  import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
  import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
  import type { RemMessage } from '../../../types.js';
  import type { SessionStore } from '../../../sdk/storage-provider.js';
  import { getMetaBoolean, getMetaString } from '../metadata.js';
  import { UnsupportedSessionSchemaError } from '../errors.js';

  export class SqliteSessionProvider implements SessionProvider {
    constructor(private store: SessionStore) {}

    async create(): Promise<Session> {
      return this.store.create('default');
    }

    async load(sessionId: string): Promise<Session | null> {
      const session = await this.store.load(sessionId);
      if (!session) return null;
      const schemaVersion = session.metadata?.schemaVersion ?? 1;
      if (schemaVersion < 2) {
        throw new UnsupportedSessionSchemaError(schemaVersion, sessionId);
      }
      return session;
    }

    addMessage(session: Session, role: 'assistant' | 'tool'): RemMessage {
      const messageId = randomUUID();
      let message: Message;
      if (role === 'assistant') {
        message = { role: 'assistant', content: [], timestamp: Date.now() } as unknown as Message;
      } else {
        message = { role: 'toolResult', toolCallId: '', toolName: '', content: [], isError: false, timestamp: Date.now() } as unknown as Message;
      }
      session.conversation.push(message);
      const messageMeta = (session.metadata.messageMeta ?? {}) as Record<string, string>;
      messageMeta[messageId] = messageId;
      session.metadata = { ...session.metadata, messageMeta };
      void this.save(session).catch(() => {});
      return { messageId, message };
    }

    appendContent(session: Session, message: Message, block: TextContent | ThinkingContent | ToolCall): void {
      (message.content as unknown[]).push(block);
      void this.save(session).catch(() => {});
    }

    async save(session: Session): Promise<void> {
      await this.store.save(session);
    }

    async delete(sessionId: string): Promise<void> {
      await this.store.delete(sessionId);
    }

    async list(): Promise<SessionSummary[]> {
      return this.store.listAll();
    }
  }
  ```

- [ ] **Step 3: 修改 `packages/core/src/plugins/session/in-memory/index.ts`**

  ```ts
  import { randomUUID } from 'crypto';
  import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
  import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
  import type { RemMessage } from '../../../types.js';
  import { UnsupportedSessionSchemaError } from '../errors.js';
  import { getMetaBoolean, getMetaString } from '../metadata.js';

  export class InMemorySessionProvider implements SessionProvider {
    private sessions = new Map<string, Session>();

    async create(): Promise<Session> {
      const now = new Date();
      const session: Session = {
        sessionId: randomUUID(),
        conversation: [],
        currentTurn: 0,
        metadata: { schemaVersion: 2 },
        createdAt: now,
        updatedAt: now,
      };
      this.sessions.set(session.sessionId, structuredClone(session));
      return session;
    }

    async load(sessionId: string): Promise<Session | null> {
      const stored = this.sessions.get(sessionId);
      if (!stored) return null;
      const session = structuredClone(stored);
      const schemaVersion = session.metadata?.schemaVersion ?? 1;
      if (schemaVersion < 2) {
        throw new UnsupportedSessionSchemaError(schemaVersion, sessionId);
      }
      return session;
    }

    addMessage(session: Session, role: 'assistant' | 'tool'): RemMessage {
      const messageId = randomUUID();
      let message: Message;
      if (role === 'assistant') {
        message = { role: 'assistant', content: [], timestamp: Date.now() } as unknown as Message;
      } else {
        message = { role: 'toolResult', toolCallId: '', toolName: '', content: [], isError: false, timestamp: Date.now() } as unknown as Message;
      }
      session.conversation.push(message);
      const messageMeta = (session.metadata.messageMeta ?? {}) as Record<string, string>;
      messageMeta[messageId] = messageId;
      session.metadata = { ...session.metadata, messageMeta };
      void this.save(session).catch(() => {});
      return { messageId, message };
    }

    appendContent(session: Session, message: Message, block: TextContent | ThinkingContent | ToolCall): void {
      (message.content as unknown[]).push(block);
      void this.save(session).catch(() => {});
    }

    async save(session: Session): Promise<void> {
      const updated: Session = {
        ...session,
        updatedAt: new Date(),
      };
      this.sessions.set(session.sessionId, structuredClone(updated));
    }

    async list(): Promise<SessionSummary[]> {
      const result: SessionSummary[] = [];
      for (const session of this.sessions.values()) {
        result.push({
          sessionId: session.sessionId,
          title: getMetaString(session.metadata, 'title'),
          pinned: getMetaBoolean(session.metadata, 'pinned'),
          updatedAt: session.updatedAt,
          messageCount: session.conversation.length,
        });
      }
      result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return result;
    }

    async delete(sessionId: string): Promise<void> {
      this.sessions.delete(sessionId);
    }
  }
  ```

- [ ] **Step 4: 修改 `packages/core/src/plugins/session/local/index.ts`**

  删除 `msgCache`、`cueMessages`、`pullMessages`、`.msg.json` 相关逻辑，只保留索引管理：

  ```ts
  import { readFile, writeFile, unlink } from 'fs/promises';
  import { join } from 'path';
  import type { Session, SessionSummary } from '../../../sdk/session-provider.js';
  import { BaseSessionProvider } from '../base.js';
  import { getMetaBoolean, getMetaString } from '../metadata.js';

  interface IndexEntry {
    sessionId: string;
    title?: string;
    pinned?: boolean;
    updatedAt: string;
    messageCount: number;
  }

  export class LocalSessionProvider extends BaseSessionProvider {
    private dir: string;

    constructor(dir: string) {
      super(dir);
      this.dir = dir;
    }

    private indexPath(): string {
      return join(this.dir, 'index.json');
    }

    async create(): Promise<Session> {
      const session = await super.create();
      await this.updateIndex(session);
      return session;
    }

    async load(sessionId: string): Promise<Session | null> {
      return super.load(sessionId);
    }

    async save(session: Session): Promise<void> {
      await this.store.save(session);
      await this.updateIndex(session);
    }

    async list(): Promise<SessionSummary[]> {
      const index = await this.readIndex();
      return index.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        pinned: s.pinned,
        updatedAt: new Date(s.updatedAt),
        messageCount: s.messageCount,
      }));
    }

    async delete(sessionId: string): Promise<void> {
      await this.store.delete(sessionId);
      await this.removeFromIndex(sessionId);
    }

    private async updateIndex(session: Session): Promise<void> {
      const index = await this.readIndex();
      const count = Array.isArray(session.conversation) ? session.conversation.length : 0;
      const existing = index.findIndex((s) => s.sessionId === session.sessionId);
      const entry: IndexEntry = {
        sessionId: session.sessionId,
        title: getMetaString(session.metadata, 'title'),
        pinned: getMetaBoolean(session.metadata, 'pinned'),
        updatedAt: session.updatedAt.toISOString(),
        messageCount: count,
      };
      if (existing >= 0) {
        index[existing] = entry;
      } else {
        index.push(entry);
      }
      index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      await this.writeIndex(index);
    }

    private async removeFromIndex(sessionId: string): Promise<void> {
      const index = await this.readIndex();
      await this.writeIndex(index.filter((s) => s.sessionId !== sessionId));
    }

    private async readIndex(): Promise<IndexEntry[]> {
      try {
        const raw = await readFile(this.indexPath(), 'utf-8');
        return JSON.parse(raw) as IndexEntry[];
      } catch {
        return [];
      }
    }

    private async writeIndex(index: IndexEntry[]): Promise<void> {
      await writeFile(this.indexPath(), JSON.stringify(index, null, 2), 'utf-8');
    }
  }
  ```

- [ ] **Step 5: 删除旧迁移测试文件**

  Run: `rm packages/core/tests/session-migration.test.ts`

  Expected: 文件已删除。

- [ ] **Step 6: 更新 `packages/core/tests/session.test.ts`**

  使用 `pi.Message` 并新增 `UnsupportedSessionSchemaError` 回归测试：

  ```ts
  import { describe, it, expect } from 'vitest';
  import { InMemorySessionProvider } from '../src/plugins/session/in-memory/index.js';
  import { UnsupportedSessionSchemaError } from '../src/plugins/session/errors.js';
  import type { Message } from '@earendil-works/pi-ai';

  describe('InMemorySessionProvider', () => {
    it('should create a new session', async () => {
      const provider = new InMemorySessionProvider();
      const session = await provider.create();

      expect(session.sessionId).toBeDefined();
      expect(session.conversation).toEqual([]);
      expect(session.currentTurn).toBe(0);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });

    it('should load an existing session', async () => {
      const provider = new InMemorySessionProvider();
      const created = await provider.create();
      created.conversation.push({ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() } as Message);
      await provider.save(created);

      const loaded = await provider.load(created.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.conversation).toHaveLength(1);
      expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('should return null for unknown session id', async () => {
      const provider = new InMemorySessionProvider();
      const loaded = await provider.load('unknown-id');
      expect(loaded).toBeNull();
    });

    it('should update updatedAt on save', async () => {
      const provider = new InMemorySessionProvider();
      const session = await provider.create();
      const before = session.updatedAt.getTime();
      await new Promise((r) => setTimeout(r, 10));
      await provider.save(session);
      const loaded = await provider.load(session.sessionId);
      expect(loaded!.updatedAt.getTime()).toBeGreaterThan(before);
    });

    it('should list sessions sorted by updatedAt desc', async () => {
      const provider = new InMemorySessionProvider();
      const a = await provider.create();
      await new Promise((r) => setTimeout(r, 10));
      const b = await provider.create();
      await new Promise((r) => setTimeout(r, 10));
      const c = await provider.create();

      a.metadata.title = 'Alpha';
      a.conversation.push({ role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() } as Message);
      await provider.save(a);

      b.conversation.push({ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() } as Message);
      b.conversation.push({ role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() } as Message);
      await provider.save(b);

      await new Promise((r) => setTimeout(r, 10));
      await provider.save(c);

      const list = await provider.list();
      expect(list).toHaveLength(3);
      for (let i = 0; i < list.length - 1; i++) {
        expect(list[i].updatedAt.getTime()).toBeGreaterThanOrEqual(list[i + 1].updatedAt.getTime());
      }
      expect(list.some((s) => s.title === 'Alpha')).toBe(true);
      expect(list.some((s) => s.messageCount === 2)).toBe(true);
    });

    it('should delete a session', async () => {
      const provider = new InMemorySessionProvider();
      const session = await provider.create();
      await provider.delete(session.sessionId);
      const loaded = await provider.load(session.sessionId);
      expect(loaded).toBeNull();
    });

    it('should list pinned metadata', async () => {
      const provider = new InMemorySessionProvider();
      const a = await provider.create();
      a.metadata.title = 'A';
      a.metadata.pinned = true;
      await provider.save(a);

      const b = await provider.create();
      b.metadata.title = 'B';
      await provider.save(b);

      const list = await provider.list();
      const summaryA = list.find((s) => s.sessionId === a.sessionId);
      const summaryB = list.find((s) => s.sessionId === b.sessionId);
      expect(summaryA?.pinned).toBe(true);
      expect(summaryB?.pinned).toBeUndefined();
    });

    it('throws UnsupportedSessionSchemaError for schemaVersion=1', async () => {
      const provider = new InMemorySessionProvider();
      const session = await provider.create();
      session.metadata.schemaVersion = 1;
      await provider.save(session);
      await expect(provider.load(session.sessionId)).rejects.toBeInstanceOf(UnsupportedSessionSchemaError);
    });
  });
  ```

- [ ] **Step 7: 更新 `packages/core/tests/file-session-provider.test.ts`**

  使用 `pi.Message` 并新增 `UnsupportedSessionSchemaError` 回归测试：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtemp, rm } from 'fs/promises';
  import { join } from 'path';
  import { tmpdir } from 'os';
  import { FileSessionProvider } from '../src/plugins/session/file/index.js';
  import { UnsupportedSessionSchemaError } from '../src/plugins/session/errors.js';
  import type { Message } from '@earendil-works/pi-ai';

  describe('FileSessionProvider', () => {
    let dir: string;
    let provider: FileSessionProvider;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'file-session-test-'));
      provider = new FileSessionProvider(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('should create a new session and persist to file', async () => {
      const session = await provider.create();
      expect(session.sessionId).toBeDefined();
      expect(session.conversation).toEqual([]);
      expect(session.currentTurn).toBe(0);
      const loaded = await provider.load(session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(session.sessionId);
    });

    it('should save and load session with conversation', async () => {
      const session = await provider.create();
      session.conversation.push({ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() } as Message);
      session.metadata.title = 'Test Title';
      await provider.save(session);
      const loaded = await provider.load(session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.conversation).toHaveLength(1);
      expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hello' }]);
      expect(loaded!.metadata.title).toBe('Test Title');
    });

    it('should return null for non-existent session', async () => {
      const loaded = await provider.load('nonexistent');
      expect(loaded).toBeNull();
    });

    it('should list sessions sorted by updatedAt desc', async () => {
      const a = await provider.create();
      await new Promise((r) => setTimeout(r, 15));
      const b = await provider.create();
      await new Promise((r) => setTimeout(r, 15));
      const c = await provider.create();

      a.metadata.title = 'First';
      await provider.save(a);
      await new Promise((r) => setTimeout(r, 15));
      b.metadata.title = 'Second';
      await provider.save(b);
      await new Promise((r) => setTimeout(r, 15));
      c.metadata.title = 'Third';
      await provider.save(c);

      const list = await provider.list();
      expect(list).toHaveLength(3);
      expect(list[0].sessionId).toBe(c.sessionId);
      expect(list[0].title).toBe('Third');
      expect(list[1].sessionId).toBe(b.sessionId);
      expect(list[2].sessionId).toBe(a.sessionId);
    });

    it('should deserialize Date fields correctly', async () => {
      const session = await provider.create();
      const loaded = await provider.load(session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.createdAt).toBeInstanceOf(Date);
      expect(loaded!.updatedAt).toBeInstanceOf(Date);
      expect(loaded!.createdAt.getTime()).toBeGreaterThan(0);
    });

    it('should return empty list for empty directory', async () => {
      const list = await provider.list();
      expect(list).toEqual([]);
    });

    it('should auto-create directory on create', async () => {
      const subDir = join(dir, 'nested', 'sessions');
      const nestedProvider = new FileSessionProvider(subDir);
      const session = await nestedProvider.create();
      const loaded = await nestedProvider.load(session.sessionId);
      expect(loaded).not.toBeNull();
    });

    it('should delete a session file', async () => {
      const session = await provider.create();
      await provider.delete(session.sessionId);
      const loaded = await provider.load(session.sessionId);
      expect(loaded).toBeNull();
    });

    it('should not throw when deleting non-existent session', async () => {
      await expect(provider.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('should list pinned metadata', async () => {
      const a = await provider.create();
      a.metadata.title = 'Pinned';
      a.metadata.pinned = true;
      await provider.save(a);
      const b = await provider.create();
      b.metadata.title = 'Normal';
      await provider.save(b);
      const list = await provider.list();
      const summaryA = list.find((s) => s.sessionId === a.sessionId);
      const summaryB = list.find((s) => s.sessionId === b.sessionId);
      expect(summaryA?.pinned).toBe(true);
      expect(summaryB?.pinned).toBeUndefined();
    });

    it('throws UnsupportedSessionSchemaError for schemaVersion=1', async () => {
      const session = await provider.create();
      session.metadata.schemaVersion = 1;
      await provider.save(session);
      await expect(provider.load(session.sessionId)).rejects.toBeInstanceOf(UnsupportedSessionSchemaError);
    });
  });
  ```

- [ ] **Step 8: 更新 `packages/core/tests/local-session-provider.test.ts`**

  使用 `pi.Message`，删除 `cueMessages` / `pullMessages` / `msgCache` 用例，新增 `UnsupportedSessionSchemaError` 回归测试：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtemp, rm } from 'fs/promises';
  import { join } from 'path';
  import { tmpdir } from 'os';
  import { LocalSessionProvider } from '../src/plugins/session/local/index.js';
  import { UnsupportedSessionSchemaError } from '../src/plugins/session/errors.js';
  import type { Message } from '@earendil-works/pi-ai';

  describe('LocalSessionProvider', () => {
    let dir: string;
    let provider: LocalSessionProvider;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'local-session-test-'));
      provider = new LocalSessionProvider(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('should create a new session and persist to file', async () => {
      const session = await provider.create();
      expect(session.sessionId).toBeDefined();
      expect(session.conversation).toEqual([]);
      expect(session.currentTurn).toBe(0);
      const loaded = await provider.load(session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(session.sessionId);
    });

    it('should save and load session with conversation', async () => {
      const session = await provider.create();
      session.conversation.push({ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.now() } as Message);
      session.metadata.title = 'Test Title';
      await provider.save(session);
      const loaded = await provider.load(session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.conversation).toHaveLength(1);
      expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hello' }]);
      expect(loaded!.metadata.title).toBe('Test Title');
    });

    it('should return null for non-existent session', async () => {
      const loaded = await provider.load('nonexistent');
      expect(loaded).toBeNull();
    });

    it('should list sessions sorted by updatedAt desc', async () => {
      const a = await provider.create();
      await new Promise((r) => setTimeout(r, 15));
      const b = await provider.create();
      await new Promise((r) => setTimeout(r, 15));
      const c = await provider.create();

      a.metadata.title = 'First';
      await provider.save(a);
      await new Promise((r) => setTimeout(r, 15));
      b.metadata.title = 'Second';
      await provider.save(b);
      await new Promise((r) => setTimeout(r, 15));
      c.metadata.title = 'Third';
      await provider.save(c);

      const list = await provider.list();
      expect(list).toHaveLength(3);
      expect(list[0].sessionId).toBe(c.sessionId);
      expect(list[0].title).toBe('Third');
      expect(list[1].sessionId).toBe(b.sessionId);
      expect(list[2].sessionId).toBe(a.sessionId);
    });

    it('updates index updatedAt when session is re-saved', async () => {
      const a = await provider.create();
      await new Promise((r) => setTimeout(r, 20));
      const b = await provider.create();
      await provider.save(a);
      const list = await provider.list();
      expect(list[0].sessionId).toBe(a.sessionId);
      expect(list[1].sessionId).toBe(b.sessionId);
    });

    it('should deserialize Date fields correctly', async () => {
      const session = await provider.create();
      const loaded = await provider.load(session.sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.createdAt).toBeInstanceOf(Date);
      expect(loaded!.updatedAt).toBeInstanceOf(Date);
      expect(loaded!.createdAt.getTime()).toBeGreaterThan(0);
    });

    it('should return empty list for empty directory', async () => {
      const list = await provider.list();
      expect(list).toEqual([]);
    });

    it('should auto-create directory on create', async () => {
      const subDir = join(dir, 'nested', 'sessions');
      const nestedProvider = new LocalSessionProvider(subDir);
      const session = await nestedProvider.create();
      const loaded = await nestedProvider.load(session.sessionId);
      expect(loaded).not.toBeNull();
    });

    it('should delete a session file and remove from index', async () => {
      const session = await provider.create();
      await provider.save(session);
      await provider.delete(session.sessionId);
      const loaded = await provider.load(session.sessionId);
      expect(loaded).toBeNull();
      const list = await provider.list();
      expect(list.find((s) => s.sessionId === session.sessionId)).toBeUndefined();
    });

    it('should not throw when deleting non-existent session', async () => {
      await expect(provider.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('should list pinned metadata', async () => {
      const a = await provider.create();
      a.metadata.title = 'Pinned';
      a.metadata.pinned = true;
      await provider.save(a);
      const b = await provider.create();
      b.metadata.title = 'Normal';
      await provider.save(b);
      const list = await provider.list();
      const summaryA = list.find((s) => s.sessionId === a.sessionId);
      const summaryB = list.find((s) => s.sessionId === b.sessionId);
      expect(summaryA?.pinned).toBe(true);
      expect(summaryB?.pinned).toBeUndefined();
    });

    it('throws UnsupportedSessionSchemaError for schemaVersion=1', async () => {
      const session = await provider.create();
      session.metadata.schemaVersion = 1;
      await provider.save(session);
      await expect(provider.load(session.sessionId)).rejects.toBeInstanceOf(UnsupportedSessionSchemaError);
    });
  });
  ```

- [ ] **Step 9: 运行 session 相关测试**

  Run: `pnpm --filter rem-agent-core test -- tests/session.test.ts tests/file-session-provider.test.ts tests/local-session-provider.test.ts`

  Expected: 全部通过。

- [ ] **Step 10: Commit**

  ```bash
  git add packages/core/src/plugins/session/base.ts packages/core/src/plugins/session/sqlite/index.ts packages/core/src/plugins/session/in-memory/index.ts packages/core/src/plugins/session/local/index.ts
  git add packages/core/tests/session.test.ts packages/core/tests/file-session-provider.test.ts packages/core/tests/local-session-provider.test.ts
  git rm packages/core/tests/session-migration.test.ts
  git commit -m "refactor(core): session providers use pi.Message[] and throw UnsupportedSessionSchemaError for v1"
  ```

---

## Task 6: Bridge 导出与剩余引用清理

**Files:**
- Modify: `packages/bridge/src/index.ts`
- Modify: `packages/core/src/sdk/agent-state-provider.ts`

- [ ] **Step 1: 修改 `packages/bridge/src/index.ts`**

  ```ts
  export { parseSSEStream, parseAgentStreamEvent } from './sse.js';
  export { createSSEResponse, createBusSSEResponse } from './response.js';
  export type {
    RunRequest,
    SessionSummary,
    SessionUpdate,
    InterruptRequest,
    ResetRequest,
    ServerStreamEvent,
    UIMessage,
    UiContentBlock,
    ToolResultBlock,
    BusEvent,
    SessionActivity,
    Workspace,
    AddWorkspaceRequest,
    RemoveWorkspaceRequest,
  } from './types.js';
  export type { SSEEvent } from './sse.js';
  export type { AgentStreamEvent } from 'rem-agent-core';

  export { reduceStreamEvent } from './stream-reducer.js';

  export type { IAgentService } from './agent-service.interface.js';
  export { AgentRemoteService } from './agent-remote-service.js';

  export { AgentService } from './agent.js';
  export { BridgeAgentStateProvider } from './agent-state-provider.js';
  export { ServiceError } from './errors.js';
  export { BroadcastBus, createBroadcastBus } from './broadcast-bus.js';
  export { JsonWorkspaceRepository } from './workspace-repository-json.js';
  export { SqliteWorkspaceRepository } from './workspace-repository-sqlite.js';
  export type { WorkspaceRepository } from './workspace-repository.js';
  ```

- [ ] **Step 2: 修改 `packages/core/src/sdk/agent-state-provider.ts`**

  删除未使用的 `ContentPart` import：

  ```ts
  import type { AgentLiveState } from '../state.js';
  import type { Rule } from '../security/rules/rule.js';

  /* ---- Approval types ---- */
  ...
  ```

  文件其余部分保持不变。

- [ ] **Step 3: 全局搜索残留引用**

  Run: `rg "ModelMessage|ContentPart|MessageContent|migrateConversationToPiAi|toPiMessage|fromPiMessage|toPiTool|toPiToolResultMessage|fromPiAssistantMessage|composeToolSet" packages/ --type ts --type tsx`

  Expected: 没有任何命中（`rg` 即 ripgrep，若未安装可用 `grep -r` 替代）。

- [ ] **Step 4: 运行类型检查**

  Run: `pnpm typecheck`

  Expected: 可能仍有个别测试/实现中的 `getToolSet` 返回对象或 `ModelMessage` 引用报错，需继续 Task 7 清理。但 Bridge 与 Core 实现层应无错误。

- [ ] **Step 5: Commit**

  ```bash
  git add packages/bridge/src/index.ts packages/core/src/sdk/agent-state-provider.ts
  git commit -m "refactor(bridge,core): stop re-exporting ModelMessage/ContentPart and clean unused import"
  ```

---

## Task 7: 剩余测试与数据层适配

**Files:**
- Modify: `packages/core/tests/jsonl-session-store.test.ts`
- Modify: `packages/core/tests/simple-memory-provider.test.ts`
- Modify: `packages/core/tests/run-agent.test.ts` 中已包含的 composedToolSet 等（Task 2 已覆盖，这里确认）

- [ ] **Step 1: 修改 `packages/core/tests/jsonl-session-store.test.ts`**

  使用 `pi.Message` 替代 `ModelMessage`（不再使用 `id` 字段）：

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { mkdtemp, rm, readFile, writeFile, readdir } from 'fs/promises';
  import { join } from 'path';
  import { tmpdir } from 'os';
  import { JsonlSessionStore } from '../src/plugins/session/jsonl-store.js';
  import type { Message } from '@earendil-works/pi-ai';
  import type { Session } from '../src/session.js';

  function textMessage(text: string): Message {
    return { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() };
  }

  function makeSession(sessionId: string, messages: Message[], overrides: Partial<Session> = {}): Session {
    return {
      sessionId,
      conversation: messages,
      currentTurn: 0,
      metadata: {},
      createdAt: new Date('2026-07-06T00:00:00Z'),
      updatedAt: new Date('2026-07-06T00:00:00Z'),
      ...overrides,
    };
  }
  ```

  其余测试用例中凡使用 `textMessage('m1', 'hi')` 的地方改为 `textMessage('hi')`，并去掉对 `JSON.parse(lines[0]).id` 的断言，改为断言 `JSON.parse(lines[0]).content`。例如：

  ```ts
  // 原：expect(JSON.parse(lines[0]).id).toBe('m1');
  // 改为：
  expect(JSON.parse(lines[0]).content).toEqual([{ type: 'text', text: 'first' }]);
  expect(JSON.parse(lines[1]).content).toEqual([{ type: 'text', text: 'second' }]);
  ```

  所有 `makeSession('s1', [textMessage('m1', 'hi')], ...)` 改为 `makeSession('s1', [textMessage('hi')], ...)`。测试 message 数量、content 等断言保持不变。

- [ ] **Step 2: 修改 `packages/core/tests/simple-memory-provider.test.ts`**

  ```ts
  import { describe, it, expect } from 'vitest';
  import { SimpleMemoryProvider } from '../src/plugins/memory/simple/index.js';
  import type { Session } from '../src/session.js';
  import type { Message } from '@earendil-works/pi-ai';
  import type { ConfigProvider } from '../src/sdk/config-provider.js';

  // mockConfigProvider 保持不变

  function makeSession(conversation: Message[] = []): Session {
    return {
      sessionId: 's1',
      conversation,
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  describe('SimpleMemoryProvider', () => {
    it('should build context with system prompt and conversation', async () => {
      const provider = new SimpleMemoryProvider(mockConfigProvider('TestAgent'));
      const session = makeSession([{ role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: Date.now() }]);
      const ctx = await provider.buildContext(session, 'TestAgent');
      expect(ctx.systemPrompt).toBe('You are TestAgent.');
      expect(ctx.messages).toHaveLength(1);
      expect(ctx.messages[0].role).toBe('user');
    });

    it('should return empty messages for fresh session', async () => {
      const provider = new SimpleMemoryProvider(mockConfigProvider('Agent'));
      const session = makeSession();
      const ctx = await provider.buildContext(session, 'Agent');
      expect(ctx.messages).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 3: 运行全量测试**

  Run: `pnpm typecheck && pnpm test`

  Expected: 全部通过。如果还有失败，根据错误信息回到对应步骤修复；禁止通过修改测试断言来“绕过”实现问题。

- [ ] **Step 4: Commit**

  ```bash
  git add packages/core/tests/jsonl-session-store.test.ts packages/core/tests/simple-memory-provider.test.ts
  git commit -m "test(core): adapt jsonl store and memory provider tests to pi.Message"
  ```

---

## Task 8: 文档更新

**Files:**
- Modify: `packages/core/README.md`
- Modify: `AGENTS.md`（项目根目录）
- Modify: `AGENTS.md`（项目根目录）
- Modify: `docs/module-reference.md`
- Modify: `docs/superpowers/specs/2026-07-15-pi-ai-llm-migration-design.md`

- [ ] **Step 1: 修改 `packages/core/README.md`**

  - 在 **Module Responsibilities** 表格中，把 `llm` 行改为：
    ```
    | `llm` | `createCoreModels` (pi-ai Models 初始化), `context-window.ts` |
    ```
  - 在 **API Reference → `llm` → `pi-adapter`** 小节，删除该 `pi-adapter` 代码块与说明段落（原第 300-316 行）。保留 `createCoreModels` 与 `context-window` 小节。
  - 在 **API Reference → `types`** 的 `ModelMessage` 描述处，改为仅说明 `RemMessage` 与 `Message` 的关系：
    ```markdown
    `SessionProvider.addMessage()` returns a `RemMessage`, which pairs a Core-generated `messageId` with the underlying `pi.Message`. These message IDs are stored in `Session.metadata.messageMeta` so that UI layers can attach per-message metadata without mutating the `pi.Message` itself.
    ```

- [ ] **Step 2: 更新根目录 `AGENTS.md`**

  把 `packages/core/src/pi-adapter.ts` 从常用入口表移除，并新增类型约定说明。最终相关段落如下：

  ```markdown
  | 文件 | 用途 |
  |---|---|
  | `packages/core/src/agent-factory.ts` | `createAgentFromEnv` |
  | `packages/core/src/loop-strategy.ts` | `ReactLoop` / `LoopStrategy` 导出 |
  | `packages/core/src/plugins/loop/react/index.ts` | `ReactLoop` 实现 |
  | `packages/core/src/reason/reason.ts` | `reason()`：使用 `models.stream` 执行 ReAct reason |
  | `packages/core/src/reason/generate.ts` | `generate()`：使用 `models.complete` 执行非流式生成 |
  | `packages/core/src/llm/models.ts` | `createCoreModels`：pi-ai `Models` 集合初始化 |
  | `packages/core/src/llm/context-window.ts` | 上下文窗口大小解析 |

  ### 4. 直接复用 pi-ai 类型

  - `ToolSet` 统一为 `pi.Tool[]`；`ToolProvider.getToolSet()` 直接返回可传给 `pi-ai.Context.tools` 的数组。
  - Core 内部消息类型统一为 `pi.Message`；不再维护 `ModelMessage` / `ContentPart` 等自建表示层。
  - 旧 schema v1 session 数据不再兼容；加载时会抛出 `UnsupportedSessionSchemaError`。
  ```

- [ ] **Step 3: 修改 `docs/module-reference.md`**

  - `src/types.ts` 条目：删除 `ModelMessage` 行，保留 `RemMessage`、`AgentStreamEvent`、`AgentStreamStepResult`、`AgentStream`、`AgentStatus`、`ToolCallRecord`、`TurnResult` 等。
  - `src/tool-composer.ts` 条目：描述改为 `DefaultToolComposer` 组装 `CompositeToolProvider` / `OverlayToolProvider` 并注册 `read_skill`；返回的 `ToolProvider.getToolSet()` 直接为 `pi.Tool[]`。
  - `plugins/session/local/` 条目：删除 `cueMessages()` / `pullMessages()` 相关描述；只保留 `index.json` 管理 + `BaseSessionProvider` 的 schema 检查。
  - 在 `llm` 小节删除 `pi-adapter.ts` 相关描述（如果存在）。

- [ ] **Step 3: 修改 `docs/module-reference.md`**

  - `src/types.ts` 条目：删除 `ModelMessage` 行，保留 `RemMessage`、`AgentStreamEvent`、`AgentStreamStepResult`、`AgentStream`、`AgentStatus`、`ToolCallRecord`、`TurnResult` 等。
  - `src/tool-composer.ts` 条目：描述改为 `DefaultToolComposer` 组装 `CompositeToolProvider` / `OverlayToolProvider` 并注册 `read_skill`；返回的 `ToolProvider.getToolSet()` 直接为 `pi.Tool[]`。
  - `plugins/session/local/` 条目：删除 `cueMessages()` / `pullMessages()` 相关描述；只保留 `index.json` 管理 + `BaseSessionProvider` 的 schema 检查。
  - 在 `llm` 小节删除 `pi-adapter.ts` 相关描述（如果存在）。

- [ ] **Step 4: 修改 `docs/superpowers/specs/2026-07-15-pi-ai-llm-migration-design.md`**

  在 Phase 3 部分追加说明（通常位于 Phase 3 小节末尾）：

  ```markdown
  > 2026-07-16 后续清理：本阶段已彻底删除 `packages/core/src/pi-adapter.ts`，移除 `ModelMessage` / `ContentPart` 自建类型、`migrateConversationToPiAi` 等旧 schema 迁移逻辑，并把 `ToolSet` 统一为 `pi.Tool[]`。详细实施计划见 `docs/superpowers/plans/2026-07-16-remove-pi-adapter-conversion-layer.md`。
  ```

- [ ] **Step 5: 最终全量验证**

  Run: `pnpm typecheck && pnpm test`

  Expected: 全绿。

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core/README.md AGENTS.md docs/module-reference.md docs/superpowers/specs/2026-07-15-pi-ai-llm-migration-design.md
  git commit -m "docs(core,bridge): remove pi-adapter references and update module docs"
  ```

---

## Self-Review Checklist

> 在把计划交给执行者之前，逐条核对设计文档 `docs/superpowers/specs/2026-07-16-remove-pi-adapter-conversion-layer-design.md`。

### 1. 设计文档覆盖度

| 设计目标 | 计划 Task | 状态 |
|---|---|---|
| 删除 `pi-adapter.ts` | Task 1 Step 1 | ✅ 覆盖 |
| 删除 `types.ts` 中 `ModelMessage` / `ContentPart` / `MessageContent` | Task 1 Step 2 | ✅ 覆盖 |
| `ToolSet` 对齐 `pi-ai.Tool[]` | Task 1 Step 3 + Task 2 | ✅ 覆盖 |
| `generate()` 直接返回 `pi.AssistantMessage` 并提取字段 | Task 3 Step 2 | ✅ 覆盖 |
| `execute-tools.ts` 直接构造 `ToolResultMessage` | Task 3 Step 3 | ✅ 覆盖 |
| 删除 `LocalSessionProvider` 缓存方法 | Task 5 Step 4 | ✅ 覆盖 |
| 删除 schema v1 迁移，统一抛出 `UnsupportedSessionSchemaError` | Task 1 Step 4 + Task 5 | ✅ 覆盖 |
| 同步更新 Bridge 导出、测试、文档 | Task 6 + Task 7 + Task 8 | ✅ 覆盖 |
| `RemMessage` / `AgentStreamEvent` 保留 | 明确在设计约束中，未删除 | ✅ 覆盖 |

### 2. Placeholder 扫描

- [ ] 无 `TBD` / `TODO` / `implement later` / `fill in details`。
- [ ] 无 “add appropriate error handling” / “add validation” 等模糊描述。
- [ ] 每个代码修改步骤都给出完整代码片段或精确替换说明。
- [ ] 无 “similar to Task X” 的省略；每个受影响文件都独立列出修改点。

### 3. 类型一致性

- [ ] `ToolSet` 在所有位置均为 `pi.Tool[]`：`sdk/tool-provider.ts`、`registry/tool-registry.ts`、`plugins/tool/in-memory/index.ts`、`mcp/tool-provider.ts`、`mcp/composite-tool-provider.ts`、`overlay-tool-provider.ts`。
- [ ] `generate()` 返回 `AssistantMessage`；调用方 `title` 和 `compressor` 从 `result.content` 提取 tool call / text。
- [ ] `reason()` / `generate()` 的 `tools` 参数直接透传，不再调用 `toPiTool`。
- [ ] `TurnResult.newMessages` 为 `pi.Message[]`。
- [ ] `execute-tools.ts` 构造的 `ToolResultMessage` 字段与 `pi-ai.ToolResultMessage` 一致（`role: 'toolResult'`, `toolCallId`, `toolName`, `content`, `isError`, `timestamp`）。
- [ ] 所有 session provider 的 `load()` 在 `schemaVersion < 2` 时抛出 `UnsupportedSessionSchemaError`。
- [ ] Bridge 不再导出 `ModelMessage` / `ContentPart`。

### 4. 遗漏风险检查

- [ ] `packages/core/src/index.ts` 通过 `export * from './types.js'` 导出 `TurnResult` 等；确认 `ModelMessage` / `ContentPart` 不再被导出。
- [ ] `packages/core/src/sdk/agent-state-provider.ts` 删除未使用的 `ContentPart` import。
- [ ] 所有测试中 `getToolSet() => ({})` 已改为返回空数组 `[]`。
- [ ] 所有测试中 `tools.echo` / `tools['name']` 对象访问已改为数组 `find` / `some`。
- [ ] `jsonl-session-store.test.ts` 不再依赖 `id` 字段；断言改为 content。
- [ ] `local-session-provider.test.ts` 已删除 `cueMessages` / `pullMessages` / `msgCache` 用例。
- [ ] `docs/superpowers/specs/2026-07-15-pi-ai-llm-migration-design.md` 已补充 Phase 3 完成说明。

---

*Plan created: 2026-07-16*
