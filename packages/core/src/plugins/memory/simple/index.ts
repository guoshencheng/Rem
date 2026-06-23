import type { MemoryProvider, MemoryContext } from '../../../sdk/memory-provider.js';
import type { AgentState } from '../../../state.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';

export interface SimpleMemoryProviderOptions {
  agentName: string;
}

export class SimpleMemoryProvider implements MemoryProvider {
  constructor(private agentName: string) {}

  async buildContext(state: AgentState): Promise<MemoryContext> {
    return {
      systemPrompt: `You are ${this.agentName}.`,
      messages: state.conversation,
    };
  }
}

export function createProvider(options: SimpleMemoryProviderOptions | undefined): SimpleMemoryProvider {
  return new SimpleMemoryProvider(options?.agentName ?? 'Rem Agent');
}

export function getDefaultOptions(ctx: ProviderLoaderContext): SimpleMemoryProviderOptions {
  return { agentName: ctx.agentName };
}
