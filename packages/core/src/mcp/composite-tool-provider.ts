import type { TObject } from '@sinclair/typebox';
import type {
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolExecutor,
  ToolProvider,
  ToolResult,
} from '../sdk/tool-provider.js';
import type { ApprovalChunkEmitter } from '../sdk/approval-orchestrator.js';
import type { ToolSet } from '../llm/types.js';

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
    const result: ToolSet = { ...this.primary.getToolSet() };
    for (const provider of this.mcpProviders) {
      const set = provider.getToolSet();
      for (const [name, schema] of Object.entries(set)) {
        if (result[name]) {
          console.warn(`[CompositeToolProvider] duplicate tool "${name}" overwritten by MCP provider`);
        }
        result[name] = schema;
      }
    }
    return result;
  }

  async execute(calls: ToolCall[], ctx: ToolContext, emit?: ApprovalChunkEmitter): Promise<ToolResult[]> {
    const grouped = new Map<ToolProvider, ToolCall[]>();

    for (const call of calls) {
      const owner = this.ownership.get(call.toolName) ?? this.primary;
      const list = grouped.get(owner) ?? [];
      list.push(call);
      grouped.set(owner, list);
    }

    const results: ToolResult[] = [];
    for (const [provider, providerCalls] of grouped) {
      const providerResults = await provider.execute(providerCalls, ctx, emit);
      results.push(...providerResults);
    }
    return results;
  }

  private refreshOwnership(): void {
    this.ownership.clear();
    for (const provider of this.mcpProviders) {
      for (const name of Object.keys(provider.getToolSet())) {
        this.ownership.set(name, provider);
      }
    }
  }
}
