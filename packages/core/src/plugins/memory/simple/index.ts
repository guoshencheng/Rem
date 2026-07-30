import type { ContextProvider } from '../../../sdk/context-provider.js';
import type { MemoryProvider, MemoryContext } from '../../../sdk/memory-provider.js';
import type { Message } from '@earendil-works/pi-ai';
import type { Session } from '../../../session/model.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';

export class SimpleContextProvider implements ContextProvider, MemoryProvider {
  private agentName: string;

  constructor(configProvider: ConfigProvider) {
    this.agentName = configProvider.getBehaviorConfig().name;
  }

  async build(session: Session, _agentName: string): Promise<{ system: string; messages: Message[] }> {
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
