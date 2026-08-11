import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { REMAgentRunExecutor } from '../src/execution/rem-agent-executor.js';
import { RecordingToolProvider } from '../src/execution/recording-tool-provider.js';
import { normalizeRuntimeToolContribution } from '../src/application/contexts/runtime-tool-definition.js';
import { StaticToolProvider } from '../src/plugins/tool/static/index.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const at = new Date('2026-08-11T00:00:00Z');
const run = { runId: 'r', tenantId: 't', principalId: 'p', sessionId: 's', agentId: 'a', agentRevision: '1', status: 'running' as const,
  trigger: { type: 'message' as const, content: 'go' }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at };

async function prepared() {
  const { store } = await createFakeRuntimeStore();
  await store.transaction((uow) => {
    uow.sessions.insert({ sessionId: 's', tenantId: 't', contexts: { bindings: [] }, createdAt: at, updatedAt: at });
    uow.runs.insert(run);
  });
  return store;
}

function recorder(storage: RuntimeStorage, execute: () => Promise<unknown>) {
  const provider = new StaticToolProvider([{ definition: { name: 'tool', description: 'tool', parameters: Type.Object({}) },
    executor: execute as never }]);
  return new RecordingToolProvider({ storage, provider, run, allowedToolNames: ['tool'] });
}

describe('Runtime abort boundaries', () => {
  it('pre-aborted executor touches no dependency', async () => {
    const controller = new AbortController(); controller.abort();
    let definitions = 0; let storage = 0; let plugins = 0;
    const executor = new REMAgentRunExecutor({ assembly: {} as never,
      agentDefinitions: { init: async () => {}, list: async () => [], get: async () => { definitions += 1; return null; } },
      storage: { transaction: async () => { storage += 1; return undefined; } } as never,
      pluginHost: { materializeSnapshot: async () => { plugins += 1; return []; } } as never });
    await expect(executor.execute({ run, session: { sessionId: 's', tenantId: 't', contexts: { bindings: [] }, createdAt: at, updatedAt: at }, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'EXECUTION_CANCELLED' });
    expect({ definitions, storage, plugins }).toEqual({ definitions: 0, storage: 0, plugins: 0 });
  });

  it('abort while waiting for transaction lock writes nothing and calls no tool', async () => {
    const base = await prepared();
    const controller = new AbortController(); let release!: () => void; let called = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocked = { ...base, transaction: async (operation: never) => { await gate; return base.transaction(operation); } } as RuntimeStorage;
    const pending = recorder(blocked, async () => { called += 1; return { output: 'no' }; })
      .execute([{ toolCallId: 'c', toolName: 'tool', input: {} }], { cwd: '/', workspaceRoot: '/', signal: controller.signal });
    controller.abort(); release();
    await expect(pending).rejects.toMatchObject({ code: 'EXECUTION_CANCELLED' });
    expect(called).toBe(0);
    expect(await base.transaction((uow) => uow.toolInvocations.listByRun('r'))).toEqual([]);
  });

  it('abort after planning but before provider call records a known cancellation', async () => {
    const base = await prepared();
    const controller = new AbortController(); let transactions = 0; let called = 0;
    const wrapped = { ...base, transaction: async (operation: never) => {
      const value = await base.transaction(operation); transactions += 1;
      if (transactions === 1) controller.abort();
      return value;
    } } as RuntimeStorage;
    await expect(recorder(wrapped, async () => { called += 1; return { output: 'no' }; })
      .execute([{ toolCallId: 'c', toolName: 'tool', input: {} }], { cwd: '/', workspaceRoot: '/', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'EXECUTION_CANCELLED' });
    expect(called).toBe(0);
    expect(await base.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'failed', error: 'Tool execution cancelled' }]);
    expect(await base.listEvents('r')).toMatchObject([{ type: 'tool.started' }, { type: 'tool.failed', data: { errorCode: 'EXECUTION_CANCELLED' } }]);
  });

  it('abort after the provider returns but before success commit leaves executing', async () => {
    const base = await prepared();
    const controller = new AbortController(); let transactions = 0; let called = 0;
    const wrapped = { ...base, transaction: async (operation: never) => {
      transactions += 1;
      if (transactions === 2) controller.abort();
      return base.transaction(operation);
    } } as RuntimeStorage;
    await expect(recorder(wrapped, async () => { called += 1; return { output: 'done' }; })
      .execute([{ toolCallId: 'c', toolName: 'tool', input: {} }], { cwd: '/', workspaceRoot: '/', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'EXECUTION_CANCELLED' });
    expect(called).toBe(1);
    expect(await base.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'executing' }]);
    expect((await base.listEvents('r')).map((event) => event.type)).toEqual(['tool.started']);
  });

  it('rechecks cancellation after definition loading before storage access', async () => {
    const controller = new AbortController(); let storage = 0;
    const executor = new REMAgentRunExecutor({ assembly: {} as never,
      agentDefinitions: { init: async () => {}, list: async () => [], get: async () => { controller.abort(); return {
        agentId: 'a', revision: '1', name: 'a', instructions: 'a', modelId: 'm', toolNames: [], acceptedTriggers: ['message'], execution: { type: 'single-agent' },
      }; } }, storage: { transaction: async () => { storage += 1; } } as never,
      pluginHost: {} as never });
    await expect(executor.execute({ run, session: { sessionId: 's', tenantId: 't', contexts: { bindings: [] }, createdAt: at, updatedAt: at }, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'EXECUTION_CANCELLED' });
    expect(storage).toBe(0);
  });

  it('checks abort inside the history transaction before reading entries', async () => {
    const base = await prepared(); const controller = new AbortController();
    let release!: () => void; let entryReads = 0; let pluginCalls = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const storage = { ...base, transaction: async (operation: (uow: unknown) => unknown) => {
      await gate;
      return base.transaction(((uow) => operation({ ...uow, sessions: { ...uow.sessions,
        listEntries: (id: string) => { entryReads += 1; return uow.sessions.listEntries(id); },
      } })) as never);
    } } as RuntimeStorage;
    const executor = new REMAgentRunExecutor({ assembly: {} as never,
      agentDefinitions: { init: async () => {}, list: async () => [], get: async () => ({
        agentId: 'a', revision: '1', name: 'a', instructions: 'a', modelId: 'm', toolNames: [], acceptedTriggers: ['message'], execution: { type: 'single-agent' },
      }) }, storage, pluginHost: { materializeSnapshot: async () => { pluginCalls += 1; return []; } } as never });
    const pending = executor.execute({ run, session: { sessionId: 's', tenantId: 't', contexts: { bindings: [] }, createdAt: at, updatedAt: at }, signal: controller.signal });
    controller.abort(); release();
    await expect(pending).rejects.toMatchObject({ code: 'EXECUTION_CANCELLED' });
    expect({ entryReads, pluginCalls }).toEqual({ entryReads: 0, pluginCalls: 0 });
  });
});

describe('Runtime tool result boundary', () => {
  it.each([
    ['date', () => ({ output: 'x', details: new Date() })],
    ['class', () => ({ output: 'x', details: new (class Value {})() })],
    ['function', () => ({ output: 'x', details: () => 1 })],
    ['symbol', () => ({ output: 'x', details: Symbol('x') })],
    ['undefined', () => ({ output: undefined })],
    ['nonfinite', () => ({ output: 'x', details: Infinity })],
    ['sparse', () => ({ output: 'x', details: Array(1) })],
    ['cycle', () => { const details: { self?: unknown } = {}; details.self = details; return { output: 'x', details }; }],
  ])('marks invalid %s results failed', async (_name, makeResult) => {
    const store = await prepared();
    await expect(recorder(store, async () => makeResult()).execute(
      [{ toolCallId: 'c', toolName: 'tool', input: {} }], { cwd: '/', workspaceRoot: '/' },
    )).rejects.toMatchObject({ code: 'TOOL_EXECUTION_FAILED' });
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'failed', error: 'Tool result is invalid' }]);
    expect((await store.listEvents('r')).map((event) => event.type)).toEqual(['tool.started', 'tool.failed']);
  });

  it('rejects a result getter without executing it', async () => {
    const store = await prepared(); let reads = 0;
    const details = {}; Object.defineProperty(details, 'secret', { enumerable: true, get: () => { reads += 1; return 'x'; } });
    await expect(recorder(store, async () => ({ output: 'x', details })).execute(
      [{ toolCallId: 'c', toolName: 'tool', input: {} }], { cwd: '/', workspaceRoot: '/' },
    )).rejects.toMatchObject({ code: 'TOOL_EXECUTION_FAILED' });
    expect(reads).toBe(0);
  });

  it('keeps storage failure precedence while finalizing an invalid result', async () => {
    const base = await prepared(); let transactions = 0;
    const wrapped = { ...base, transaction: async (operation: never) => {
      transactions += 1;
      if (transactions === 2) throw new Error('storage unavailable');
      return base.transaction(operation);
    } } as RuntimeStorage;
    await expect(recorder(wrapped, async () => ({ output: 'x', details: new Date() })).execute(
      [{ toolCallId: 'c', toolName: 'tool', input: {} }], { cwd: '/', workspaceRoot: '/' },
    )).rejects.toThrow('storage unavailable');
    expect(await base.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'executing' }]);
  });
});

describe('Runtime plugin tool definition boundary', () => {
  it('accepts and isolates a real TypeBox schema', () => {
    const schema = Type.Object({ id: Type.String() });
    const normalized = normalizeRuntimeToolContribution({ definition: { name: 'tool', description: 'tool', parameters: schema }, executor: async () => ({ output: 'x' }) });
    schema.properties.id.type = 'number' as never;
    expect(normalized.definition.parameters).not.toBe(schema);
    expect((normalized.definition.parameters as typeof schema).properties.id.type).toBe('string');
  });

  it.each(['sideEffect', 'boolean', 'symbol', 'nonenumerable', 'prototype', 'schema-class', 'schema-symbol', 'schema-hidden'])('rejects invalid %s definitions', (kind) => {
    const definition: Record<PropertyKey, unknown> = { name: 'tool', description: 'tool', parameters: Type.Object({}) };
    if (kind === 'sideEffect') definition.sideEffect = 'maybe';
    if (kind === 'boolean') definition.supportsIdempotencyKey = 'yes';
    if (kind === 'symbol') definition[Symbol('evil')] = true;
    if (kind === 'nonenumerable') Object.defineProperty(definition, 'hidden', { value: true });
    if (kind === 'prototype') Object.setPrototypeOf(definition, { evil: true });
    if (kind === 'schema-class') definition.parameters = new (class Schema {})();
    if (kind === 'schema-symbol') (definition.parameters as Record<PropertyKey, unknown>)[Symbol('evil')] = true;
    if (kind === 'schema-hidden') Object.defineProperty(definition.parameters as object, 'hidden', { value: true });
    expect(() => normalizeRuntimeToolContribution({ definition, executor: async () => ({ output: 'x' }) }))
      .toThrow(expect.objectContaining({ code: 'CONTEXT_INVALID' }));
  });

  it('does not execute definition or executor getters', () => {
    let reads = 0; const contribution = {};
    Object.defineProperty(contribution, 'definition', { enumerable: true, get: () => { reads += 1; return {}; } });
    Object.defineProperty(contribution, 'executor', { enumerable: true, get: () => { reads += 1; return () => {}; } });
    expect(() => normalizeRuntimeToolContribution(contribution)).toThrow(expect.objectContaining({ code: 'CONTEXT_INVALID' }));
    expect(reads).toBe(0);
  });

  it('does not execute nested schema getters', () => {
    let reads = 0; const schema = Type.Object({});
    Object.defineProperty(schema, 'secret', { enumerable: true, get: () => { reads += 1; return 'x'; } });
    expect(() => normalizeRuntimeToolContribution({ definition: { name: 'tool', description: 'tool', parameters: schema }, executor: async () => ({ output: 'x' }) }))
      .toThrow(expect.objectContaining({ code: 'CONTEXT_INVALID' }));
    expect(reads).toBe(0);
  });

  it('captures derive functions once and isolates concurrent run snapshots', async () => {
    const sharedPatterns = ['one'];
    const sharedOptions = [{ label: 'Allow', rule: { permission: 'tool', pattern: 'one', action: 'allow' as const } }];
    const definition = { name: 'tool', description: 'tool', parameters: Type.Object({}),
      derivePatterns: () => sharedPatterns, deriveAlwaysOptions: () => sharedOptions };
    const first = normalizeRuntimeToolContribution({ definition, executor: async () => ({ output: 'x' }) });
    const second = normalizeRuntimeToolContribution({ definition, executor: async () => ({ output: 'x' }) });
    definition.derivePatterns = () => ['replaced']; delete (definition as { deriveAlwaysOptions?: unknown }).deriveAlwaysOptions;
    const [firstPatterns, secondPatterns] = await Promise.all([
      Promise.resolve().then(() => first.definition.derivePatterns!({})),
      Promise.resolve().then(() => second.definition.derivePatterns!({})),
    ]);
    firstPatterns.push('mutated'); secondPatterns.push('other');
    const firstOptions = first.definition.deriveAlwaysOptions!({}); firstOptions[0]!.label = 'mutated';
    expect(first.definition.derivePatterns!({})).toEqual(['one']);
    expect(second.definition.derivePatterns!({})).toEqual(['one']);
    expect(first.definition.deriveAlwaysOptions!({})).toEqual(sharedOptions);
    expect(second.definition.deriveAlwaysOptions!({})).toEqual(sharedOptions);
  });

  it('invokes derives with undefined this and rejects thenable results', () => {
    let seenThis: unknown = 'unset';
    const normalized = normalizeRuntimeToolContribution({ definition: { name: 'tool', description: 'tool', parameters: Type.Object({}),
      derivePatterns: function () { seenThis = this; return ['ok']; },
      deriveAlwaysOptions: () => Promise.resolve([]),
    }, executor: async () => ({ output: 'x' }) });
    expect(normalized.definition.derivePatterns!({})).toEqual(['ok']);
    expect(seenThis).toBeUndefined();
    expect(() => normalized.definition.deriveAlwaysOptions!({})).toThrow(expect.objectContaining({ code: 'CONTEXT_INVALID' }));
  });
});
