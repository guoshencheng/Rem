import type { MemoryProvider, MemoryContext } from '../../src/sdk/memory-provider.js';
import type { AgentState } from '../../src/state.js';
import type { ProviderLoaderContext } from '../../src/sdk/provider-loader.js';

export interface CustomMemoryProviderOptions {
  prefix: string;
}

export class CustomMemoryProvider implements MemoryProvider {
  constructor(private options: CustomMemoryProviderOptions) {}

  async buildContext(state: AgentState): Promise<MemoryContext> {
    return {
      systemPrompt: `${this.options.prefix}: ${state.conversation.length} messages`,
      messages: state.conversation,
    };
  }
}

export function createProvider(options: CustomMemoryProviderOptions): CustomMemoryProvider {
  return new CustomMemoryProvider(options);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): CustomMemoryProviderOptions {
  return { prefix: ctx.agentName };
}
