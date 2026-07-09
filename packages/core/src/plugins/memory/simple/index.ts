import type { ContextProvider } from '../../../sdk/context-provider.js';
import type { MemoryProvider, MemoryContext } from '../../../sdk/memory-provider.js';
import type { ModelMessage } from '../../../types.js';
import type { Session } from '../../../session.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';

export class SimpleContextProvider implements ContextProvider, MemoryProvider {
  private agentName: string;

  constructor(configProvider: ConfigProvider) {
    this.agentName = configProvider.getBehaviorConfig().name;
  }

  async build(session: Session, _agentName: string): Promise<{ system: string; messages: ModelMessage[] }> {
    return {
      system: '',
      messages: session.conversation,
    };
  }

  async buildContext(session: Session, agentName: string): Promise<MemoryContext> {
    return {
      systemPrompt: `You are ${this.agentName}.`,
      messages: session.conversation,
    };
  }
}

export { SimpleContextProvider as SimpleMemoryProvider };
