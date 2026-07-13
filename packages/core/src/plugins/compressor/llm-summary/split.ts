import type { ModelMessage } from '../../../types.js';

export interface SplitResult {
  head: ModelMessage[];
  middle: ModelMessage[];
  tail: ModelMessage[];
}

export function splitHeadTail(
  messages: ModelMessage[],
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
