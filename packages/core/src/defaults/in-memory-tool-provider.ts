import { tool, type ToolSet } from 'ai';
import type { ToolProvider, ToolDefinition, ToolCall, ToolResult } from '../sdk/tool-provider.js';

export class InMemoryToolProvider implements ToolProvider {
  private tools = new Map<string, { def: ToolDefinition; executor: (input: unknown) => Promise<string> }>();

  register(def: ToolDefinition, executor: (input: unknown) => Promise<string>): void {
    this.tools.set(def.name, { def, executor });
  }

  getToolSet(): ToolSet {
    const result: ToolSet = {};
    for (const [name, { def }] of this.tools) {
      result[name] = tool({
        description: def.description,
        parameters: def.parameters as any,
      });
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
