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
