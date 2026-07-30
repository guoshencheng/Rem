import type { TObject } from '@sinclair/typebox';
import type {
  ToolCall, ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolResult, ToolSet,
} from '../../../sdk/tool-provider.js';

export interface CustomTool {
  definition: ToolDefinition<TObject>;
  executor: ToolExecutor<TObject>;
}

/** 内存工具集：register 模式，无 Node 依赖。 */
export class StaticToolProvider implements ToolProvider {
  private definitions = new Map<string, ToolDefinition>();
  private executors = new Map<string, ToolExecutor>();

  constructor(tools: CustomTool[] = []) {
    for (const t of tools) this.register(t.definition, t.executor);
  }

  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
    this.definitions.set(def.name, def as unknown as ToolDefinition);
    this.executors.set(def.name, executor as ToolExecutor);
  }

  getToolSet(): ToolSet {
    return [...this.definitions.values()].map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    })) as ToolSet;
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      const executor = this.executors.get(call.toolName);
      if (!executor) {
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `unknown tool: ${call.toolName}` });
        continue;
      }
      try {
        const r = await executor(call.input as never, ctx);
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: r.output, details: r.details });
      } catch (err) {
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  isDangerous(toolName: string): boolean {
    return this.definitions.get(toolName)?.dangerous ?? false;
  }
}
