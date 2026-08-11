import type { ImageContent, TextContent } from '@earendil-works/pi-ai';

export type UserMessageContent = string | Array<TextContent | ImageContent>;

export function isUserMessageContent(value: unknown): value is UserMessageContent {
  return typeof value === 'string' || Array.isArray(value)
    && value.every((part) => typeof part === 'object' && part !== null
      && ('type' in part) && (part.type === 'text' || part.type === 'image'));
}
