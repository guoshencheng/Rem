import type { Message, Usage } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { RemMetaEvent } from './types.js';
import type { REMAgent } from './rem-agent.js';

/**
 * REMAgent 向上抛出的事件。
 * - pi.AgentEvent / RemMetaEvent：原样上抛（最终成为 BusEvent chunk）。
 * - message-persist：一条已完成消息待 SessionService 落盘。
 * - child-spawned：delegate_task 创建了子 Agent，AgentService 应 listen。
 * - usage：本次 run 的累计 token usage（assistantMessageId 用于挂 messageTokenUsage）。
 */
export type REMAgentEvent =
  | AgentEvent
  | RemMetaEvent
  | { type: 'message-persist'; message: Message; messageId: string }
  | { type: 'child-spawned'; child: REMAgent; parentToolCallId: string }
  | { type: 'usage'; usage: Usage; assistantMessageId?: string };
