import type { TObject } from '@sinclair/typebox';
import type { AgentRun, ToolInvocation } from '../domain/run/types.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type {
  ToolCall, ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolResult, ToolSet,
} from '../sdk/tool-provider.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { generateId } from '../shared/generate-id.js';
import { ToolFatalState } from './tool-fatal-state.js';
import { assertToolNotAborted } from './tool-execution-control.js';
import { findOrPlanInvocation, reuseSuccessfulInvocation, validateExistingInput } from './recording-tool-invocation.js';
import { normalizeRecordedToolResult } from './recording-tool-result.js';
import { cloneToolInput, validateToolInput } from './recording-tool-input.js';
import type { RuntimeObservationSink } from '../sdk/runtime-observer.js';
import { observeTool, observeToolSettlementFailure } from './tool-observation.js';
import { executeRecordedToolCall } from './recording-tool-call.js';
import { finishRecordedTool, finishRecordedToolSuccess, markRecordedToolUnknown } from './recording-tool-persistence.js';

export interface RecordingToolProviderOptions {
  storage: RuntimeStorage;
  provider: ToolProvider;
  run: AgentRun;
  allowedToolNames: readonly string[];
  now?: () => Date;
  generateId?: () => string;
  fatalState?: ToolFatalState;
  observe?: RuntimeObservationSink;
}
/** Run-scoped tool boundary that enforces the definition allow-list and records effects. */
export class RecordingToolProvider implements ToolProvider {
  private readonly allowed: Set<string>;
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly fatal: ToolFatalState;
  constructor(private readonly options: RecordingToolProviderOptions) {
    this.allowed = new Set(options.allowedToolNames);
    this.now = options.now ?? (() => new Date());
    this.id = options.generateId ?? generateId;
    this.fatal = options.fatalState ?? new ToolFatalState(() => {});
  }
  register<T extends TObject>(_def: ToolDefinition<T>, _executor: ToolExecutor<T>): void {
    throw new RuntimeError('TOOL_DENIED', 'Runtime tool provider is immutable');
  }
  getToolSet(): ToolSet {
    return this.options.provider.getToolSet().filter((tool) => this.allowed.has(tool.name));
  }
  getToolDefinition(name: string): ToolDefinition | undefined {
    if (!this.allowed.has(name)) return undefined;
    return this.options.provider.getToolDefinition(name);
  }
  isDangerous(name: string): boolean {
    this._assertAvailable(name);
    return this.options.provider.isDangerous(name);
  }
  async execute(calls: ToolCall[], context: ToolContext): Promise<ToolResult[]> {
    this.fatal.assertHealthy();
    assertToolNotAborted(context.signal);
    const results: ToolResult[] = [];
    for (const call of calls) results.push(await this._executeOne(call, context));
    return results;
  }
  private async _executeOne(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    this.fatal.assertHealthy();
    assertToolNotAborted(context.signal);
    const definition = this._assertAvailable(call.toolName);
    const input = cloneToolInput(call.input, 'Tool input is not JSON-compatible');
    const planned = await this._storage(() => findOrPlanInvocation({
      storage: this.options.storage, run: this.options.run, call, input, definition, context,
      now: this.now, generateId: this.id, event: (sequence, type, data) => this._event(sequence, type, data),
    }));
    if (planned.existing) {
      const existing = validateExistingInput(planned.invocation, call, input);
      if (existing.status === 'succeeded') return reuseSuccessfulInvocation(existing, call);
      if (existing.status === 'failed') {
        return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: existing.error ?? 'Tool execution failed' };
      }
      if (existing.status === 'unknown') throw new RuntimeError('TOOL_RESULT_UNKNOWN', `Tool invocation ${call.toolCallId} has an unknown result`);
      if (existing.status === 'executing') throw new RuntimeError('RUN_CONFLICT', `Tool invocation ${call.toolCallId} is already executing`);
      await this._storage(() => this.options.storage.transaction((uow) => {
        const current = uow.toolInvocations.getByRunAndCall(this.options.run.runId, call.toolCallId, this.options.run.rootNodeId);
        if (!current || current.status !== 'planned') throw new RuntimeError('RUN_CONFLICT', `Tool invocation ${call.toolCallId} changed before takeover`);
        uow.toolInvocations.update({ ...current, status: 'executing', updatedAt: this.now() });
      }));
      planned.invocation.status = 'executing';
    }
    const idempotencyKey = `${this.options.run.runId}:${this.options.run.rootNodeId === undefined ? '' : `${this.options.run.rootNodeId}:`}${call.toolCallId}`;
    const invocation = planned.invocation;
    if (context.signal?.aborted) {
      await this._finish(invocation, 'failed', undefined, 'Tool execution cancelled', 'tool.failed', 'EXECUTION_CANCELLED');
      throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
    }
    const inputError = validateToolInput(definition, input);
    if (inputError) {
      await this._finish(invocation, 'failed', undefined, inputError, 'tool.failed', 'TOOL_EXECUTION_FAILED');
      observeTool(this.options.observe, 'failed', invocation, undefined, 'TOOL_EXECUTION_FAILED');
      return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: inputError };
    }
    const startedAt = Date.now();
    observeTool(this.options.observe, 'started', invocation);
    let result: ToolResult;
    try {
      const settled = await executeRecordedToolCall(this.options.provider, {
        ...call, input: cloneToolInput(input, 'Tool input is not JSON-compatible'),
      }, { ...context, principalId: this.options.run.principalId }, invocation, idempotencyKey);
      if (settled.kind === 'aborted') {
        await this._markUnknown(invocation, 'EXECUTION_CANCELLED');
        observeTool(this.options.observe, 'unknown', invocation, Date.now() - startedAt, 'EXECUTION_CANCELLED');
        throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
      }
      if (settled.kind === 'rejected') throw settled.error;
      [result] = settled.value;
    } catch (error) {
      this.fatal.assertHealthy();
      if (error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED') throw error;
      if (error instanceof RuntimeError && error.code === 'TOOL_RESULT_UNKNOWN') {
        await this._markUnknown(invocation, 'TOOL_RESULT_UNKNOWN');
        observeTool(this.options.observe, 'unknown', invocation, Date.now() - startedAt, 'TOOL_RESULT_UNKNOWN');
        throw error;
      }
      if (context.signal?.aborted) {
        await this._markUnknown(invocation, 'EXECUTION_CANCELLED');
        observeTool(this.options.observe, 'unknown', invocation, Date.now() - startedAt, 'EXECUTION_CANCELLED');
        throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
      }
      await this._finish(invocation, 'failed', undefined, 'Tool execution failed', 'tool.failed');
      observeTool(this.options.observe, 'failed', invocation, Date.now() - startedAt, 'TOOL_EXECUTION_FAILED');
      throw new RuntimeError('TOOL_EXECUTION_FAILED', 'Tool execution failed', false, undefined, { cause: error });
    }
    if (context.signal?.aborted) {
      await this._markUnknown(invocation, 'EXECUTION_CANCELLED');
      observeTool(this.options.observe, 'unknown', invocation, Date.now() - startedAt, 'EXECUTION_CANCELLED');
      throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
    }
    if (!result) {
      await this._finish(invocation, 'failed', undefined, 'Tool returned no result', 'tool.failed');
      observeTool(this.options.observe, 'failed', invocation, Date.now() - startedAt, 'TOOL_EXECUTION_FAILED');
      throw new RuntimeError('TOOL_EXECUTION_FAILED', 'Tool execution failed');
    }
    let normalized: { persisted: unknown; returned: ToolResult };
    try {
      normalized = normalizeRecordedToolResult(call, result);
    } catch (error) {
      await this._finish(invocation, 'failed', undefined, 'Tool result is invalid', 'tool.failed', 'TOOL_EXECUTION_FAILED');
      observeTool(this.options.observe, 'failed', invocation, Date.now() - startedAt, 'TOOL_EXECUTION_FAILED');
      throw new RuntimeError('TOOL_EXECUTION_FAILED', 'Tool result is invalid', false, undefined, { cause: error });
    }
    if (result.error) {
      await this._finish(invocation, 'failed', undefined, 'Tool execution failed', 'tool.failed');
      observeTool(this.options.observe, 'failed', invocation, Date.now() - startedAt, 'TOOL_EXECUTION_FAILED');
      return { ...normalized.returned, output: '', error: 'Tool execution failed' };
    }
    try { await this._finishSuccess(invocation, normalized.persisted, context.signal); }
    catch (error) {
      observeToolSettlementFailure(this.options.observe, invocation, startedAt, error);
      throw error;
    }
    observeTool(this.options.observe, 'completed', invocation, Date.now() - startedAt);
    return normalized.returned;
  }
  private async _finish(invocation: ToolInvocation, status: 'succeeded' | 'failed', result: unknown, error: string | undefined, eventType: string, errorCode?: string): Promise<void> {
    await this._storage(() => finishRecordedTool(this._persistence(invocation), status, result, error, eventType, errorCode));
  }
  private async _finishSuccess(invocation: ToolInvocation, result: unknown, signal?: AbortSignal): Promise<void> {
    try {
      await this._storage(() => finishRecordedToolSuccess(this._persistence(invocation), result, signal));
    } catch (error) {
      if (signal?.aborted && error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED') {
        await this._markUnknown(invocation, 'EXECUTION_CANCELLED');
        throw error;
      }
      throw this.fatal.poison(error);
    }
  }
  private async _markUnknown(invocation: ToolInvocation, reason: string): Promise<void> {
    await this._storage(() => markRecordedToolUnknown(this._persistence(invocation), reason));
  }
  private async _storage<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED') throw error;
      throw this.fatal.poison(error);
    }
  }
  private _assertAvailable(name: string): ToolDefinition {
    if (!this.allowed.has(name)) throw new RuntimeError('TOOL_DENIED', `Tool is not allowed: ${safeText(name)}`);
    const definition = this.options.provider.getToolDefinition(name);
    if (!definition) throw new RuntimeError('TOOL_NOT_FOUND', `Tool not found: ${safeText(name)}`);
    return definition;
  }
  private _event(sequence: number, type: string, data: unknown) {
    const run = this.options.run;
    return { eventId: this.id(), sequence, schemaVersion: 1 as const, tenantId: run.tenantId,
      sessionId: run.sessionId, runId: run.runId, type, data, occurredAt: this.now() };
  }
  private _persistence(invocation: ToolInvocation) {
    return { storage: this.options.storage, invocation, now: this.now, event: (sequence: number, type: string, data: unknown) => this._event(sequence, type, data) };
  }
}
function safeText(value: string): string { return value.replace(/[\r\n\t]/g, ' ').slice(0, 500); }
