import type { AgentState } from './state.js';

export type AgentEvent =
  | 'core-agent:init' | 'core-agent:start' | 'core-agent:error'
  | 'turn:before' | 'turn:after'
  | 'phase:prepare' | 'phase:reason:before' | 'phase:reason:after'
  | 'phase:execute:before' | 'phase:execute:after'
  | 'phase:observe' | 'phase:reflect'
  | 'tool:before' | 'tool:after' | 'tool:error'
  | 'compress:before' | 'compress:after';

export interface EventContext {
  agent: unknown;
  state: AgentState;
  turn?: unknown;
  turnResult?: unknown;
  toolCall?: unknown;
}

export type EventHandler = (ctx: EventContext) => Promise<void> | void;

interface HandlerEntry {
  handler: EventHandler;
  priority: number;
}

export class EventBus {
  private handlers = new Map<AgentEvent, HandlerEntry[]>();

  on(event: AgentEvent, handler: EventHandler, priority = 50): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push({ handler, priority });
    list.sort((a, b) => b.priority - a.priority);
    this.handlers.set(event, list);

    return () => {
      const updated = list.filter(h => h.handler !== handler);
      this.handlers.set(event, updated);
    };
  }

  once(event: AgentEvent, handler: EventHandler, priority = 50): void {
    const off = this.on(event, async (ctx) => {
      off();
      await handler(ctx);
    }, priority);
  }

  async emit(event: AgentEvent, ctx: EventContext): Promise<void> {
    const list = this.handlers.get(event) ?? [];
    for (const entry of list) {
      await entry.handler(ctx);
    }
  }
}
