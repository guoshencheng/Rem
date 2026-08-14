import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { RunSignal, RunSignalSource } from './types.js';

export interface RunSignalOf<Type extends string, Data> extends RunSignal {
  type: Type;
  data: Data;
}

export type RunLiveSignal =
  | RunSignalOf<'assistant.message.started', {
    messageIndex: number;
  }>
  | RunSignalOf<'assistant.text.delta', {
    messageIndex: number;
    contentIndex: number;
    delta: string;
  }>
  | RunSignalOf<'assistant.reasoning.delta', {
    messageIndex: number;
    contentIndex: number;
    delta: string;
  }>
  | RunSignalOf<'assistant.message.completed', {
    messageIndex: number;
    message: AssistantMessage;
  }>
  | RunSignalOf<'tool.execution.started', {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>
  | RunSignalOf<'tool.execution.updated', {
    toolCallId: string;
    toolName: string;
    input: unknown;
    partialResult: unknown;
  }>
  | RunSignalOf<'tool.execution.completed', {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
  }>;

export type RunLiveSignalType = RunLiveSignal['type'];
type StripSignalEnvelope<T> = T extends RunSignal ? Omit<T, 'runId' | 'occurredAt'> : never;
export type RunLiveSignalDraft = StripSignalEnvelope<RunLiveSignal>;

export const RUN_LIVE_SIGNAL_TYPES: readonly RunLiveSignalType[] = [
  'assistant.message.started',
  'assistant.text.delta',
  'assistant.reasoning.delta',
  'assistant.message.completed',
  'tool.execution.started',
  'tool.execution.updated',
  'tool.execution.completed',
];

export function isRunLiveSignal(signal: RunSignal): signal is RunLiveSignal {
  if (!RUN_LIVE_SIGNAL_TYPES.includes(signal.type as RunLiveSignalType)) return false;
  if (signal.source !== undefined && !isSignalSource(signal.source)) return false;
  if (!isRecord(signal.data)) return false;
  switch (signal.type) {
    case 'assistant.message.started':
      return safeIndex(signal.data.messageIndex);
    case 'assistant.text.delta':
    case 'assistant.reasoning.delta':
      return safeIndex(signal.data.messageIndex)
        && safeIndex(signal.data.contentIndex)
        && typeof signal.data.delta === 'string';
    case 'assistant.message.completed':
      return safeIndex(signal.data.messageIndex)
        && isAssistantMessage(signal.data.message);
    case 'tool.execution.started':
      return typeof signal.data.toolCallId === 'string'
        && typeof signal.data.toolName === 'string'
        && isJsonValue(signal.data.input);
    case 'tool.execution.updated':
      return typeof signal.data.toolCallId === 'string'
        && typeof signal.data.toolName === 'string'
        && isJsonValue(signal.data.input)
        && isJsonValue(signal.data.partialResult);
    case 'tool.execution.completed':
      return typeof signal.data.toolCallId === 'string'
        && typeof signal.data.toolName === 'string'
        && isJsonValue(signal.data.result)
        && typeof signal.data.isError === 'boolean';
  }
  return false;
}

function isSignalSource(value: unknown): value is RunSignalSource {
  if (!isRecord(value)) return false;
  return typeof value.nodeId === 'string' && value.nodeId.length > 0
    && typeof value.agentId === 'string' && value.agentId.length > 0
    && typeof value.role === 'string' && value.role.length > 0;
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  if (!isRecord(value) || value.role !== 'assistant' || !Array.isArray(value.content)) return false;
  if (value.stopReason === 'error' || value.stopReason === 'aborted') return false;
  return typeof value.timestamp === 'number' && isJsonValue(value.content);
}

function safeIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, seen));
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => isJsonValue(record[key], seen));
}

export function isRunLiveSignalDraft(value: unknown): value is RunLiveSignalDraft {
  if (!isRecord(value) || typeof value.type !== 'string' || !('data' in value)) return false;
  return isRunLiveSignal({
    runId: 'draft', type: value.type, data: value.data, occurredAt: new Date(0),
    ...(Object.hasOwn(value, 'source') ? { source: value.source as RunSignal['source'] } : {}),
  });
}
