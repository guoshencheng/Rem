import type { Message, TextContent, ImageContent } from '@earendil-works/pi-ai';
import type { UiContentBlock } from './types.js';

export function messageToContentBlocks(message: Message): UiContentBlock[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ type: 'text', text: message.content }];
    }
    return message.content
      .filter((c): c is TextContent | ImageContent => c.type === 'text' || c.type === 'image')
      .map((c) => (c.type === 'text' ? { type: 'text' as const, text: c.text } : { type: 'image' as const, data: c.data, mimeType: c.mimeType }));
  }
  const parts: UiContentBlock[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'thinking') {
      parts.push({ type: 'thinking', thinking: block.thinking });
    } else if (block.type === 'toolCall') {
      parts.push(block);
    }
  }
  return parts;
}
