import type { ContextProvider } from '../../../sdk/context-provider.js';
import type { MemoryProvider, MemoryContext } from '../../../sdk/memory-provider.js';
import type { ModelMessage } from '../../../types.js';
import type { Session } from '../../../session.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';

export interface SimpleContextProviderOptions {
  agentName: string;
}

export class SimpleContextProvider implements ContextProvider, MemoryProvider {
  constructor(private agentName: string) {}

  async build(session: Session, _agentName: string): Promise<{ system: string; messages: ModelMessage[] }> {
    const ctx = await this.buildContext(session, _agentName);
    return { system: ctx.systemPrompt, messages: ctx.messages };
  }

  async buildContext(session: Session, agentName: string): Promise<MemoryContext> {
    return {
      systemPrompt: `You are ${this.agentName}.`,
      messages: session.conversation,
    };
  }
}

export { SimpleContextProvider as SimpleMemoryProvider };

export function createProvider(options: SimpleContextProviderOptions | undefined): SimpleContextProvider {
  return new SimpleContextProvider(options?.agentName ?? 'Rem Agent');
}

export function getDefaultOptions(ctx: ProviderLoaderContext): SimpleContextProviderOptions {
  return { agentName: ctx.agentName };
}
