import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import type { AgentEventStreamController } from '../stream/agent-event-stream.js';
import { generateId } from '../shared/generate-id.js';

export interface EventBridgeParams {
  controller: AgentEventStreamController;
}

export interface EventBridge {
  listener: (event: AgentEvent) => void;
  idOf: (message: Message) => string | undefined;
  getCurrentMessageId: () => string | undefined;
  getTotalUsage: () => Usage;
  getLastAssistantMessage: () => AssistantMessage | undefined;
}

const emptyUsage = (): Usage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const addUsage = (acc: Usage, u: Usage): void => {
  acc.input += u.input; acc.output += u.output;
  acc.cacheRead += u.cacheRead; acc.cacheWrite += u.cacheWrite;
  acc.totalTokens += u.totalTokens;
  acc.cost.input += u.cost.input; acc.cost.output += u.cost.output;
  acc.cost.cacheRead += u.cost.cacheRead; acc.cost.cacheWrite += u.cost.cacheWrite;
  acc.cost.total += u.cost.total;
};

const toolResultText = (result: unknown): string => {
  const r = result as { content?: { type: string; text?: string }[] } | undefined;
  return (r?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
};

export function createEventBridge(params: EventBridgeParams): EventBridge {
  const { controller } = params;
  const messageIds = new WeakMap<Message, string>();
  let currentMessageId: string | undefined;
  let step = 0;
  const totalUsage = emptyUsage();
  let lastAssistant: AssistantMessage | undefined;

  const listener = (event: AgentEvent): void => {
    switch (event.type) {
      case 'turn_start':
        step += 1;
        controller.emit({ type: 'step-start', step });
        break;
      case 'message_start':
        if (event.message.role === 'assistant') {
          currentMessageId = generateId();
          messageIds.set(event.message, currentMessageId);
          controller.emit({ type: 'message-start', step, messageId: currentMessageId });
        }
        break;
      case 'message_update':
        controller.emit(event.assistantMessageEvent);
        break;
      case 'message_end':
        if (event.message.role === 'assistant' && currentMessageId) {
          messageIds.set(event.message, currentMessageId);
        }
        break;
      case 'tool_execution_end': {
        const output = toolResultText(event.result);
        controller.emit({
          type: 'tool-result', toolCallId: event.toolCallId, toolName: event.toolName,
          output, error: event.isError ? output || 'tool execution failed' : undefined,
        });
        break;
      }
      case 'turn_end':
        if (event.message.role === 'assistant') {
          addUsage(totalUsage, event.message.usage);
          lastAssistant = event.message;
          messageIds.set(event.message, currentMessageId ?? generateId());
        }
        controller.emit({ type: 'step-finish', step });
        break;
    }
  };

  return {
    listener,
    idOf: (message) => messageIds.get(message),
    getCurrentMessageId: () => currentMessageId,
    getTotalUsage: () => totalUsage,
    getLastAssistantMessage: () => lastAssistant,
  };
}
