import type { RunSignal, RunSignalSource, ToolCall } from 'rem-agent-core';
import { isRunLiveSignal } from 'rem-agent-core/live-signals';
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | ToolCall;

export interface RuntimeToolResult {
  output?: string;
  error?: string;
  details?: unknown;
  partialResult?: unknown;
  pending?: boolean;
}

export interface RuntimeChat {
  messages: Array<{ messageId: string; message: import('rem-agent-core').Message }>;
  toolResults: Record<string, RuntimeToolResult>;
}

export interface RuntimeToolState {
  toolCallId: string;
  toolName: string;
  input: unknown;
  status: 'running' | 'completed' | 'failed';
  source?: RunSignalSource;
}

export interface RuntimeLiveMessage {
  messageIndex: number;
  parts: ContentBlock[];
  completed: boolean;
  source?: RunSignalSource;
}

export interface RuntimeRunProjection {
  runId: string;
  status: string;
  messages: RuntimeLiveMessage[];
  activeTools: Record<string, RuntimeToolState>;
  toolResults: Record<string, RuntimeToolResult>;
  error?: string;
}

export function createRuntimeRunProjection(runId: string): RuntimeRunProjection {
  return { runId, status: 'queued', messages: [], activeTools: {}, toolResults: {} };
}

export function applyRuntimeRunSignal(
  state: RuntimeRunProjection,
  signal: RunSignal,
): RuntimeRunProjection {
  const next = cloneProjection(state);
  applyLifecycle(next, signal);
  if (!isRunLiveSignal(signal)) return next;

  switch (signal.type) {
    case 'assistant.message.started':
      ensureMessage(next, signal.data.messageIndex, signal.source);
      break;
    case 'assistant.text.delta':
      appendPart(next, signal.data.messageIndex, signal.data.contentIndex, {
        type: 'text', text: signal.data.delta,
      }, signal.source);
      break;
    case 'assistant.reasoning.delta':
      appendPart(next, signal.data.messageIndex, signal.data.contentIndex, {
        type: 'thinking', thinking: signal.data.delta,
      }, signal.source);
      break;
    case 'assistant.message.completed': {
      const message = ensureMessage(next, signal.data.messageIndex, signal.source);
      message.parts = signal.data.message.content.map(cloneContentBlock);
      message.completed = true;
      break;
    }
    case 'tool.execution.started':
      next.activeTools[signal.data.toolCallId] = {
        toolCallId: signal.data.toolCallId,
        toolName: signal.data.toolName,
        input: cloneJson(signal.data.input),
        status: 'running',
        ...(signal.source === undefined ? {} : { source: signal.source }),
      };
      next.toolResults[signal.data.toolCallId] = { pending: true };
      ensureToolCall(next, signal.data.toolCallId, signal.data.toolName, signal.data.input);
      break;
    case 'tool.execution.updated':
      next.activeTools[signal.data.toolCallId] = {
        ...(next.activeTools[signal.data.toolCallId] ?? {
          toolCallId: signal.data.toolCallId,
          toolName: signal.data.toolName,
          input: cloneJson(signal.data.input),
          ...(signal.source === undefined ? {} : { source: signal.source }),
        }),
        input: cloneJson(signal.data.input),
        status: 'running',
        ...(signal.source === undefined ? {} : { source: signal.source }),
      };
      next.toolResults[signal.data.toolCallId] = {
        pending: true, partialResult: cloneJson(signal.data.partialResult),
      };
      break;
    case 'tool.execution.completed': {
      const result = toToolResult(signal.data.result, signal.data.isError);
      next.toolResults[signal.data.toolCallId] = result;
      next.activeTools[signal.data.toolCallId] = {
        ...(next.activeTools[signal.data.toolCallId] ?? {
          toolCallId: signal.data.toolCallId,
          toolName: signal.data.toolName,
          input: {},
        }),
        status: signal.data.isError ? 'failed' : 'completed',
        ...(signal.source === undefined ? {} : { source: signal.source }),
      };
      break;
    }
  }
  return next;
}

function applyLifecycle(state: RuntimeRunProjection, signal: RunSignal): void {
  const statusByEvent: Record<string, string> = {
    'run.created': 'queued', 'run.requeued': 'queued', 'run.started': 'running',
    'run.waiting': 'waiting', 'run.completed': 'completed',
    'run.failed': 'failed', 'run.cancelled': 'cancelled',
  };
  const status = statusByEvent[signal.type];
  if (status) state.status = status;
  if (signal.type === 'run.failed') {
    const data = signal.data;
    if (isRecord(data) && typeof data.errorCode === 'string') state.error = data.errorCode;
  }
}

function ensureMessage(state: RuntimeRunProjection, messageIndex: number, source?: RunSignalSource): RuntimeLiveMessage {
  const existing = state.messages.find((message) => message.messageIndex === messageIndex);
  if (existing) return existing;
  const message = { messageIndex, parts: [], completed: false, ...(source === undefined ? {} : { source }) };
  state.messages = [...state.messages, message].sort((a, b) => a.messageIndex - b.messageIndex);
  return message;
}

function appendPart(
  state: RuntimeRunProjection,
  messageIndex: number,
  contentIndex: number,
  part: Extract<ContentBlock, { type: 'text' | 'thinking' }>,
  source?: RunSignalSource,
): void {
  const message = ensureMessage(state, messageIndex, source);
  const existing = message.parts[contentIndex];
  if (part.type === 'text' && existing?.type === 'text') {
    message.parts[contentIndex] = { type: 'text', text: existing.text + part.text };
  } else if (part.type === 'thinking' && existing?.type === 'thinking') {
    message.parts[contentIndex] = { type: 'thinking', thinking: existing.thinking + part.thinking };
  } else {
    message.parts[contentIndex] = part;
  }
}

function ensureToolCall(
  state: RuntimeRunProjection,
  toolCallId: string,
  toolName: string,
  input: unknown,
): void {
  const target = [...state.messages].reverse().find((message) => message.completed === false)
    ?? state.messages[state.messages.length - 1]
    ?? ensureMessage(state, 0);
  if (target.parts.some((part) => part.type === 'toolCall' && part.id === toolCallId)) return;
  const tool: ToolCall = {
    type: 'toolCall', id: toolCallId, name: toolName,
    arguments: isRecord(input) ? cloneJson(input) as Record<string, unknown> : {},
  };
  target.parts = [...target.parts, tool];
}

function toToolResult(value: unknown, isError: boolean): RuntimeToolResult {
  if (isRecord(value)) {
    const output = typeof value.output === 'string' ? value.output : undefined;
    const error = typeof value.error === 'string' ? value.error : undefined;
    return isError
      ? { error: error ?? output ?? '工具执行失败', ...(value.details === undefined ? {} : { details: cloneJson(value.details) }) }
      : { ...(output === undefined ? {} : { output }), ...(value.details === undefined ? {} : { details: cloneJson(value.details) }) };
  }
  if (isError) return { error: typeof value === 'string' ? value : '工具执行失败' };
  return { output: typeof value === 'string' ? value : JSON.stringify(value) };
}

function cloneProjection(state: RuntimeRunProjection): RuntimeRunProjection {
  return {
    runId: state.runId, status: state.status, error: state.error,
    messages: state.messages.map((message) => ({
      ...message, parts: message.parts.map(cloneContentBlock),
      ...(message.source === undefined ? {} : { source: { ...message.source } }),
    })),
    activeTools: Object.fromEntries(Object.entries(state.activeTools).map(([id, tool]) => [id, {
      ...tool, input: cloneJson(tool.input),
      ...(tool.source === undefined ? {} : { source: { ...tool.source } }),
    }])),
    toolResults: Object.fromEntries(Object.entries(state.toolResults).map(([id, result]) => [id, {
      ...result,
      ...(result.details === undefined ? {} : { details: cloneJson(result.details) }),
      ...(result.partialResult === undefined ? {} : { partialResult: cloneJson(result.partialResult) }),
    }])),
  };
}

function cloneContentBlock(part: ContentBlock): ContentBlock {
  if (part.type === 'text') return { type: 'text', text: part.text };
  if (part.type === 'thinking') return { type: 'thinking', thinking: part.thinking };
  return { ...part, arguments: cloneJson(part.arguments) as Record<string, unknown> };
}

function cloneJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
