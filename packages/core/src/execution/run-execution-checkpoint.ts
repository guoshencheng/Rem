import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import type { AgentToolCall } from '@earendil-works/pi-agent-core';
import type { RunExecutionEntry } from '../domain/run/execution-models.js';
import type { ToolCall } from '../sdk/tool-provider.js';
import type { ToolInvocation } from '../domain/run/types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';

export type NodeCheckpoint =
  | { kind: 'start'; transcript: Message[] }
  | { kind: 'continue'; transcript: Message[] }
  | { kind: 'pending-tools'; transcript: Message[]; assistant: AssistantMessage; calls: ToolCall[] }
  | { kind: 'completed'; transcript: Message[]; finalMessage: AssistantMessage };

export function classifyNodeCheckpoint(entries: readonly RunExecutionEntry[], invocations: readonly ToolInvocation[], nodeId?: string): NodeCheckpoint {
  const transcript = entries.flatMap((entry) => entry.message === undefined ? [] : [structuredClone(entry.message)]);
  if (transcript.length === 0) return { kind: 'start', transcript };
  validateSequence(entries);
  const calls = new Map<string, ToolCall>();
  const results = new Set<string>();
  let openCalls: ToolCall[] = [];
  for (const entry of entries) {
    if (entry.message === undefined) continue;
    const message = entry.message;
    const local = nodeId === undefined || entry.nodeId === nodeId;
    if (!local && message.role === 'assistant') {
      if (openCalls.some((call) => !results.has(call.toolCallId))) throw invalidJournal('Message follows an incomplete tool batch');
      continue;
    }
    if (message.role === 'assistant') {
      if (openCalls.some((call) => !results.has(call.toolCallId))) {
        throw invalidJournal('Assistant message follows an incomplete tool batch');
      }
      const nextCalls = message.content.filter((part): part is AgentToolCall => part.type === 'toolCall')
        .map((call) => ({ toolCallId: call.id, toolName: call.name, input: call.arguments }));
      if (new Set(nextCalls.map((call) => call.toolCallId)).size !== nextCalls.length) {
        throw invalidJournal('Duplicate tool call in execution journal');
      }
      for (const call of nextCalls) {
        if (calls.has(call.toolCallId)) throw invalidJournal('Duplicate tool call in execution journal');
        calls.set(call.toolCallId, call);
      }
      openCalls = nextCalls;
      continue;
    }
    if (message.role === 'toolResult') {
      if (results.has(message.toolCallId)) throw invalidJournal('Duplicate tool result in execution journal');
      const call = calls.get(message.toolCallId);
      if (!call || call.toolName !== message.toolName) throw invalidJournal('Tool result does not match its assistant tool call');
      const invocation = invocations.find((candidate) => candidate.toolCallId === message.toolCallId);
      if (!invocation || !['succeeded', 'failed'].includes(invocation.status)) {
        throw invalidJournal('Tool result has no terminal invocation');
      }
      if (invocation.status === 'succeeded') validatePersistedResult(invocation);
      results.add(message.toolCallId);
      continue;
    }
    if (openCalls.some((call) => !results.has(call.toolCallId))) {
      throw invalidJournal('Message follows an incomplete tool batch');
    }
  }
  for (const invocation of invocations) {
    if (!calls.has(invocation.toolCallId)) throw invalidJournal('Tool invocation has no assistant tool call');
  }
  const finalEntry = entries.filter((entry) => entry.message !== undefined).at(-1);
  const final = finalEntry?.message;
  if (final?.role === 'assistant') {
    if (nodeId !== undefined && finalEntry?.nodeId !== nodeId) return { kind: 'continue', transcript };
    if (final.stopReason === 'error' || final.stopReason === 'aborted') throw invalidJournal('Aborted model message cannot be resumed');
    const pending = openCalls.filter((call) => !results.has(call.toolCallId));
    if (pending.length > 0) {
      for (const call of pending) {
        const invocation = invocations.find((candidate) => candidate.toolCallId === call.toolCallId);
        if (invocation?.status === 'unknown') throw new RuntimeError('TOOL_RESULT_UNKNOWN', 'Tool invocation result is unknown');
      }
      return { kind: 'pending-tools', transcript, assistant: final, calls: pending };
    }
    if (!final.content.some((part) => part.type === 'toolCall')) return { kind: 'completed', transcript, finalMessage: final };
  }
  if (final?.role === 'user' || final?.role === 'toolResult') return { kind: 'continue', transcript };
  throw invalidJournal('Execution journal does not end at a resumable checkpoint');
}

function validatePersistedResult(invocation: ToolInvocation): void {
  try {
    const result = cloneCanonicalJson(invocation.result, { omitUndefinedProperties: true });
    if (typeof result !== 'object' || result === null || Array.isArray(result)
      || typeof (result as { output?: unknown }).output !== 'string') throw new Error('Persisted tool result is invalid');
  } catch (cause) {
    throw new RuntimeError('INTERNAL_ERROR', 'Persisted tool result is invalid', false, undefined, { cause });
  }
}

function validateSequence(entries: readonly RunExecutionEntry[]): void {
  let previous = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= previous) throw invalidJournal('Execution journal sequence is invalid');
    previous = entry.sequence;
  }
}

function invalidJournal(message: string): RuntimeError {
  return new RuntimeError('INTERNAL_ERROR', message);
}
