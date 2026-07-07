import { TypeCompiler } from '@sinclair/typebox/compiler';
import type { TObject } from '@sinclair/typebox';
import type { ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolCall, ToolResult } from '../../../sdk/tool-provider.js';
import type { ToolSchema, ToolSet } from '../../../llm/types.js';

export class InMemoryToolProvider implements ToolProvider {
  private tools = new Map<
    string,
    { def: ToolDefinition; executor: ToolExecutor; check: ReturnType<typeof TypeCompiler.Compile> }
  >();

  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
    this.tools.set(def.name, {
      def: def as ToolDefinition,
      executor: executor as ToolExecutor,
      check: TypeCompiler.Compile(def.parameters),
    });
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
