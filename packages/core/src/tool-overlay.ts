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

export interface ToolOverlayEntry {
  def: ToolDefinition;
  executor: ToolExecutor;
}

export function defineOverlayTool<T extends TObject>(
  def: ToolDefinition<T>,
  executor: ToolExecutor<T>,
): ToolOverlayEntry {
  return { def: def as unknown as ToolDefinition, executor: executor as ToolExecutor };
}

export class ToolOverlay implements ToolProvider {
  private overlays = new Map<
    string,
    {
      def: ToolDefinition;
      executor: ToolExecutor;
      check: ReturnType<typeof TypeCompiler.Compile>;
    }
  >();

  constructor(
    private base: ToolProvider,
    entries: ToolOverlayEntry[] = [],
  ) {
    for (const entry of entries) {
      this.registerEntry(entry);
    }
  }

  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
    this.registerEntry(defineOverlayTool(def, executor));
  }

  private registerEntry(entry: ToolOverlayEntry): void {
    this.overlays.set(entry.def.name, {
      def: entry.def,
      executor: entry.executor,
      check: TypeCompiler.Compile(entry.def.parameters),
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
