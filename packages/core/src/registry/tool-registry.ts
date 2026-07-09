import { TypeCompiler } from '@sinclair/typebox/compiler';
import type { TObject } from '@sinclair/typebox';
import type { ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolCall, ToolResult } from '../sdk/tool-provider.js';
import type { ToolPolicyConfig } from '../sdk/tool-policy.js';
import type { ToolSchema, ToolSet } from '../llm/types.js';
import { applyToolPolicyPipeline } from '../security/tool-policy-pipeline.js';

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
    const result: ToolSet = {};
    for (const def of filtered) {
      const schema: ToolSchema = {
        description: def.description,
        parameters: def.parameters as Record<string, unknown>,
      };
      result[def.name] = schema;
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
