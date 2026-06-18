import type { ToolProvider, ToolDefinition, ToolCall, ToolResult } from '../sdk/tool-provider.js';
import type { ToolSet, ToolSchema } from '../llm/types.js';

export class InMemoryToolProvider implements ToolProvider {
  private tools = new Map<string, { def: ToolDefinition; executor: (input: unknown) => Promise<string> }>();

  register(def: ToolDefinition, executor: (input: unknown) => Promise<string>): void {
    this.tools.set(def.name, { def, executor });
  }

  getToolSet(): ToolSet {
    const result: ToolSet = {};
    for (const [name, { def }] of this.tools) {
      const schema: ToolSchema = {
        description: def.description,
        parameters: def.parameters,
      };
      result[name] = schema;
    }
    return result;
  }

  async execute(calls: ToolCall[]): Promise<ToolResult[]> {
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
      try {
        const output = await registered.executor(call.input);
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
}
