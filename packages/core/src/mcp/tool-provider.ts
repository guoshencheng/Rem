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
import type { ApprovalChunkEmitter, ApprovalOrchestrator } from '../sdk/approval-orchestrator.js';
import type { ToolHook } from '../sdk/tool-hook.js';
import type { ToolSet } from '../llm/types.js';
import { ToolHookRunner } from '../security/tool-hook-runner.js';
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
  private hookRunner: ToolHookRunner;

  constructor(
    client: McpClient,
    options: McpToolProviderOptions,
    approvalOrchestrator?: ApprovalOrchestrator,
  ) {
    this.client = client;
    this.options = options;

    const dangerousToolHook: ToolHook = (ctx) => {
      const def = this.tools.get(ctx.toolName)?.def;
      if (!def?.dangerous) return undefined;
      return {
        requireApproval: {
          title: `Run ${ctx.toolName}`,
          description: `Tool "${ctx.toolName}" is an MCP tool and requires approval.`,
          severity: 'warning',
          allowedDecisions: ['allow-once', 'allow-always', 'deny'],
        },
      };
    };

    this.hookRunner = new ToolHookRunner({ hooks: [dangerousToolHook], approvalOrchestrator });
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

  async execute(calls: ToolCall[], ctx: ToolContext, emit?: ApprovalChunkEmitter): Promise<ToolResult[]> {
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

      const hookCtx: ToolContext & { toolName: string; toolCallId?: string; input: unknown } = {
        ...ctx,
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        input: call.input,
      };

      const hookOutcome = await this.hookRunner.run(hookCtx, emit);

      if (hookOutcome.blocked) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: hookOutcome.blocked.reason,
          details: { audit: { approved: false } },
        });
        continue;
      }

      try {
        const executeParams = (hookOutcome.params ?? call.input) as Record<string, unknown>;
        const output = await this.client.callTool(entry.info.originalName, executeParams);
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

  async close(): Promise<void> {
    await this.client.close();
  }

  register<T extends TObject>(_def: ToolDefinition<T>, _executor: ToolExecutor<T>): void {
    throw new Error('Cannot manually register tools on McpToolProvider');
  }
}
