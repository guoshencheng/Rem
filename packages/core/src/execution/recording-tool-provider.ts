import type { TObject } from '@sinclair/typebox';
import type { AgentRun, ToolInvocation } from '../domain/run/types.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type {
  ToolCall, ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolResult, ToolSet,
} from '../sdk/tool-provider.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { generateId } from '../shared/generate-id.js';
import { ToolFatalState } from './tool-fatal-state.js';
import { assertToolNotAborted, raceToolSettlement } from './tool-execution-control.js';

export interface RecordingToolProviderOptions {
  storage: RuntimeStorage;
  provider: ToolProvider;
  run: AgentRun;
  allowedToolNames: readonly string[];
  now?: () => Date;
  generateId?: () => string;
  fatalState?: ToolFatalState;
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
    const input = this._clone(call.input, 'Tool input is not JSON-compatible');
    const invocationId = this.id();
    const idempotencyKey = `${this.options.run.runId}:${call.toolCallId}`;
    const createdAt = this.now();
    const invocation: ToolInvocation = {
      invocationId, tenantId: this.options.run.tenantId, sessionId: this.options.run.sessionId,
      runId: this.options.run.runId, toolCallId: call.toolCallId, toolName: call.toolName,
      status: 'executing', sideEffect: definition.sideEffect ?? 'non-idempotent',
      supportsIdempotencyKey: definition.supportsIdempotencyKey === true,
      input, createdAt, updatedAt: createdAt,
    };
    await this._storage(() => this.options.storage.transaction((uow) => {
      assertToolNotAborted(context.signal);
      uow.toolInvocations.insert({ ...invocation, status: 'planned' });
      uow.toolInvocations.update(invocation);
      uow.events.append(this._event(uow.events.nextSequence(invocation.runId), 'tool.started', {
        invocationId, toolCallId: call.toolCallId, toolName: call.toolName,
      }));
    }));
    if (context.signal?.aborted) {
      await this._finish(invocation, 'failed', undefined, 'Tool execution cancelled', 'tool.failed', 'EXECUTION_CANCELLED');
      throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
    }

    let result: ToolResult;
    try {
      const underlying = this.options.provider.execute([{ ...call, input: this._clone(input, 'Tool input is not JSON-compatible') }], {
        ...context, signal: context.signal, tenantId: invocation.tenantId,
        principalId: this.options.run.principalId, runId: invocation.runId,
        invocationId, idempotencyKey,
      });
      const settled = await raceToolSettlement(underlying, context.signal);
      if (settled.kind === 'aborted') {
        await this._markUnknown(invocation, 'EXECUTION_CANCELLED');
        throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
      }
      if (settled.kind === 'rejected') throw settled.error;
      [result] = settled.value;
    } catch (error) {
      this.fatal.assertHealthy();
      if (error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED') throw error;
      if (context.signal?.aborted) {
        await this._markUnknown(invocation, 'EXECUTION_CANCELLED');
        throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
      }
      await this._finish(invocation, 'failed', undefined, 'Tool execution failed', 'tool.failed');
      throw new RuntimeError('TOOL_EXECUTION_FAILED', 'Tool execution failed', false, undefined, { cause: error });
    }
    if (context.signal?.aborted) {
      await this._markUnknown(invocation, 'EXECUTION_CANCELLED');
      throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
    }
    if (!result) {
      await this._finish(invocation, 'failed', undefined, 'Tool returned no result', 'tool.failed');
      throw new RuntimeError('TOOL_EXECUTION_FAILED', 'Tool execution failed');
    }
    if (result.error) {
      await this._finish(invocation, 'failed', undefined, 'Tool execution failed', 'tool.failed');
      return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: 'Tool execution failed' };
    }
    let persisted: unknown;
    let returned: ToolResult;
    try {
      persisted = cloneCanonicalJson({ output: result.output, ...(result.details === undefined ? {} : { details: result.details }) });
      returned = cloneCanonicalJson({ toolCallId: result.toolCallId, toolName: result.toolName, output: result.output,
        ...(result.details === undefined ? {} : { details: result.details }) }) as ToolResult;
    } catch (error) {
      await this._finish(invocation, 'failed', undefined, 'Tool result is invalid', 'tool.failed', 'TOOL_EXECUTION_FAILED');
      throw new RuntimeError('TOOL_EXECUTION_FAILED', 'Tool result is invalid', false, undefined, { cause: error });
    }
    await this._finishSuccess(invocation, persisted, context.signal);
    return returned;
  }
  private async _finish(invocation: ToolInvocation, status: 'succeeded' | 'failed', result: unknown, error: string | undefined, eventType: string, errorCode?: string): Promise<void> {
    const updatedAt = this.now();
    await this._storage(() => this.options.storage.transaction((uow) => {
      uow.toolInvocations.update({ ...invocation, status, result, error, updatedAt });
      uow.events.append(this._event(uow.events.nextSequence(invocation.runId), eventType, {
        invocationId: invocation.invocationId, toolCallId: invocation.toolCallId, toolName: invocation.toolName,
        ...(errorCode === undefined ? {} : { errorCode }),
      }));
    }));
  }
  private async _finishSuccess(invocation: ToolInvocation, result: unknown, signal?: AbortSignal): Promise<void> {
    const updatedAt = this.now();
    try {
      await this.options.storage.transaction((uow) => {
        assertToolNotAborted(signal);
        uow.toolInvocations.update({ ...invocation, status: 'succeeded', result, updatedAt });
        uow.events.append(this._event(uow.events.nextSequence(invocation.runId), 'tool.succeeded', {
          invocationId: invocation.invocationId, toolCallId: invocation.toolCallId, toolName: invocation.toolName,
        }));
      });
    } catch (error) {
      if (signal?.aborted && error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED') {
        await this._markUnknown(invocation, 'EXECUTION_CANCELLED');
        throw error;
      }
      throw this.fatal.poison(error);
    }
  }
  private async _markUnknown(invocation: ToolInvocation, reason: string): Promise<void> {
    const updatedAt = this.now();
    await this._storage(() => this.options.storage.transaction((uow) => {
      uow.toolInvocations.update({ ...invocation, status: 'unknown', error: 'Tool result is unknown', updatedAt });
      uow.events.append(this._event(uow.events.nextSequence(invocation.runId), 'tool.result_unknown', {
        invocationId: invocation.invocationId, toolCallId: invocation.toolCallId,
        toolName: invocation.toolName, errorCode: reason, reason: 'execution-aborted',
      }));
    }));
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

  private _clone<T>(value: T, message: string): T {
    try { return cloneCanonicalJson(value) as T; }
    catch (error) { throw new RuntimeError('INVALID_INPUT', message, false, undefined, { cause: error }); }
  }
}

function safeText(value: string): string { return value.replace(/[\r\n\t]/g, ' ').slice(0, 500); }
