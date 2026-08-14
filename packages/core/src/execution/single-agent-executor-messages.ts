import type { Message } from '@earendil-works/pi-ai';

export function isPersistableMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null
    && ['user', 'assistant', 'toolResult'].includes((value as { role?: unknown }).role as string)
    && !isModelError(value);
}

export function isModelError(value: unknown): value is Message & {
  role: 'assistant'; stopReason: 'error' | 'aborted'; errorMessage?: string;
} {
  return typeof value === 'object' && value !== null && (value as { role?: unknown }).role === 'assistant'
    && ['error', 'aborted'].includes((value as { stopReason?: unknown }).stopReason as string);
}
