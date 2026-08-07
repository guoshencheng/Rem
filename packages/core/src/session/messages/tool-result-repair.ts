import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';

/**
 * 修复 transcript 中 toolResult 与 toolCall 的相邻性：
 * - 找不到匹配 toolCall 的孤儿 toolResult 直接丢弃（否则 Anthropic 协议 400）。
 * - 被其他消息（如 communication 消息、并发到达的成员消息）隔断的 toolResult 上移到其 toolCall 消息之后。
 */
export function repairToolResultAdjacency(messages: Message[]): Message[] {
  const ownerByCallId = new Map<string, Message>();
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === 'toolCall') ownerByCallId.set(part.id, message);
    }
  }
  const resultsByOwner = new Map<Message, ToolResultMessage[]>();
  for (const message of messages) {
    if (message.role !== 'toolResult') continue;
    const owner = ownerByCallId.get(message.toolCallId);
    if (!owner) continue;
    const list = resultsByOwner.get(owner) ?? [];
    list.push(message);
    resultsByOwner.set(owner, list);
  }
  return messages.flatMap((message) => {
    if (message.role === 'toolResult') return [];
    return [message, ...(resultsByOwner.get(message) ?? [])];
  });
}
