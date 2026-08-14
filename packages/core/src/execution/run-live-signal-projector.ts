import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { RunLiveSignalDraft } from '../domain/event/live-signals.js';
import type { RunSignalSource } from '../domain/event/types.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';

export type RunLiveSignalEmitter = (signal: RunLiveSignalDraft) => void;
export interface RunLiveSignalProjectorState { nextMessageIndex: number; }

/** 将内部 Agent Loop 事件投影为稳定的 Runtime 实时事件。 */
export class RunLiveSignalProjector {
  private activeMessageIndex?: number;

  constructor(
    private readonly emit: RunLiveSignalEmitter,
    private readonly source?: RunSignalSource,
    private readonly state: RunLiveSignalProjectorState = { nextMessageIndex: 0 },
  ) {}

  ingest(event: AgentEvent): void {
    switch (event.type) {
      case 'message_start':
        this.startMessage(event.message);
        return;
      case 'message_update':
        this.updateMessage(event.assistantMessageEvent);
        return;
      case 'message_end':
        this.endMessage(event.message);
        return;
      case 'tool_execution_start':
        this.emitToolSignal('tool.execution.started', event.toolCallId, event.toolName, event.args);
        return;
      case 'tool_execution_update':
        this.emitToolSignal('tool.execution.updated', event.toolCallId, event.toolName, event.args, event.partialResult);
        return;
      case 'tool_execution_end':
        this.emitToolSignal('tool.execution.completed', event.toolCallId, event.toolName, event.result, undefined, event.isError);
        return;
      default:
        return;
    }
  }

  private startMessage(message: Extract<AgentEvent, { type: 'message_start' }>['message']): void {
    if (!isAssistantMessage(message)) return;
    const messageIndex = this.state.nextMessageIndex++;
    this.activeMessageIndex = messageIndex;
    this.emit(this.withSource({ type: 'assistant.message.started', data: { messageIndex } }));
  }

  private updateMessage(event: Extract<AgentEvent, { type: 'message_update' }>['assistantMessageEvent']): void {
    const messageIndex = this.activeMessageIndex;
    if (messageIndex === undefined) return;
    if (event.type === 'text_delta') {
      this.emit(this.withSource({ type: 'assistant.text.delta', data: {
        messageIndex, contentIndex: event.contentIndex, delta: event.delta,
      } }));
    } else if (event.type === 'thinking_delta') {
      this.emit(this.withSource({ type: 'assistant.reasoning.delta', data: {
        messageIndex, contentIndex: event.contentIndex, delta: event.delta,
      } }));
    }
  }

  private endMessage(message: unknown): void {
    const messageIndex = this.activeMessageIndex;
    this.activeMessageIndex = undefined;
    if (messageIndex === undefined || !isAssistantMessage(message)) return;
    if (message.stopReason === 'error' || message.stopReason === 'aborted') return;
    this.emit(this.withSource({ type: 'assistant.message.completed', data: { messageIndex, message } }));
  }

  private withSource<T extends RunLiveSignalDraft>(draft: T): T {
    return this.source === undefined ? draft : { ...draft, source: { ...this.source } } as T;
  }

  private emitToolSignal(
    type: 'tool.execution.started' | 'tool.execution.updated' | 'tool.execution.completed',
    toolCallId: string,
    toolName: string,
    input: unknown,
    partialResult?: unknown,
    isError?: boolean,
  ): void {
    try {
      // pi-agent events may include optional fields as explicit `undefined`
      // properties.  They are absent from the public JSON contract, so omit
      // them while retaining the strict plain-JSON/accessor/cycle checks.
      const isolatedInput = cloneCanonicalJson(input, { omitUndefinedProperties: true });
      if (type === 'tool.execution.started') {
        this.emit(this.withSource({ type, data: { toolCallId, toolName, input: isolatedInput } }));
      } else if (type === 'tool.execution.updated') {
        const isolatedPartial = cloneCanonicalJson(partialResult, { omitUndefinedProperties: true });
        this.emit(this.withSource({ type, data: { toolCallId, toolName, input: isolatedInput, partialResult: isolatedPartial } }));
      } else {
        const isolatedResult = cloneCanonicalJson(input, { omitUndefinedProperties: true });
        this.emit(this.withSource({ type, data: { toolCallId, toolName, result: isolatedResult, isError: isError === true } }));
      }
    } catch {
      // A malformed provider projection is intentionally dropped; it must not
      // turn a successful model/tool execution into a failed Run.
    }
  }
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return typeof value === 'object' && value !== null
    && (value as { role?: unknown }).role === 'assistant';
}
