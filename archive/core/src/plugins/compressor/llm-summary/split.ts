import type { Message } from '@earendil-works/pi-ai';

export interface SplitResult {
  head: Message[];
  middle: Message[];
  tail: Message[];
}

export function splitHeadTail(
  messages: Message[],
  protectHead: number,
  protectTail: number,
): SplitResult {
  if (messages.length < protectHead + protectTail) {
    return { head: messages, middle: [], tail: [] };
  }
  return {
    head: messages.slice(0, protectHead),
    middle: messages.slice(protectHead, messages.length - protectTail),
    tail: messages.slice(messages.length - protectTail),
  };
}
