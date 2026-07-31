import type { Usage } from '@earendil-works/pi-ai';
import type { REMAgentEvent } from '../agent/agent-event.js';
import { addUsage, emptyUsage } from '../agent/token-usage/index.js';
import type { SessionService } from '../session/service.js';

/** 消费一次 child run，仅持久化 child Session，不转发私有流式内容。 */
export class DelegationEventDriver {
  constructor(private readonly sessionService: SessionService) {}

  async drive(sessionId: string, events: AsyncIterable<REMAgentEvent>): Promise<Usage> {
    let usage = emptyUsage();
    for await (const event of events) {
      if (event.type === 'usage') usage = addUsage(usage, event.usage);
      if (
        event.type === 'message-persist'
        || event.type === 'usage'
        || event.type === 'session-title'
        || event.type === 'compress-end'
        || event.type === 'finish'
      ) {
        await this.sessionService.persistAgentEvent(sessionId, event);
      }
    }
    return usage;
  }
}
