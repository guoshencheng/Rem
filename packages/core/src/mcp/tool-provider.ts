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
    const result: ToolSet = {};
    for (const [name, { def }] of this.tools) {
      result[name] = { description: def.description, parameters: def.parameters as Record<string, unknown> };
    }
    return result;
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
