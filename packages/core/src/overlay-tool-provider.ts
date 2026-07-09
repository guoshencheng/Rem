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
import type { ToolSet } from './llm/types.js';
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
      def: def as ToolDefinition,
      executor: executor as ToolExecutor,
      check: TypeCompiler.Compile(def.parameters),
    });
  }

  getToolSet(): ToolSet {
    const result: ToolSet = { ...this.base.getToolSet() };
    for (const [name, { def }] of this.overlays) {
      if (result[name]) {
        log('tools', 'duplicate tool overwritten by overlay', { toolName: name });
      }
      result[name] = { description: def.description, parameters: def.parameters as Record<string, unknown> };
    }
    return result;
  }

  isDangerous(toolName: string): boolean {
    const overlay = this.overlays.get(toolName);
    if (overlay) return overlay.def.dangerous === true;
    return this.base.isDangerous(toolName);
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
