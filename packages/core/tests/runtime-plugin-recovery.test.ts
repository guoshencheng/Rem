import type { ContextRuntimeContributions, RuntimePlugin, RuntimePluginRegistrar, RuntimeToolContribution } from '../src/sdk/runtime-plugin.js';
import type { ResolvedContextSnapshot } from '../src/domain/context/types.js';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';

function snapshot(type: string): ResolvedContextSnapshot {
  return {
    items: [{ binding: { type, contextId: 'id' }, pluginId: 'acme/plugin', pluginVersion: '1', snapshot: {}, snapshotHash: 'hash' }],
    configLayers: [],
    promptSections: [],
  };
}

function tool(name: string): RuntimeToolContribution {
  return {
    definition: { name, description: name, parameters: Type.Object({}) },
    executor: async () => ({ output: name }),
  };
}

function plugin(type: string, materialize: (snapshot: unknown) => Promise<ContextRuntimeContributions>): RuntimePlugin {
  return {
    manifest: { pluginId: 'acme/plugin', version: '1' },
    register: ({ addContextType }) => addContextType({ type, resolve: async () => ({ snapshot: {} }), materialize }),
  };
}

async function expectCode(action: () => unknown | Promise<unknown>, code: RuntimeError['code']): Promise<RuntimeError> {
  try {
    await action();
    throw new Error('Expected an error');
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeError);
    expect((error as RuntimeError).code).toBe(code);
    return error as RuntimeError;
  }
}

describe('RuntimePluginHost recovery boundaries', () => {
  it('拒绝异步注册，并使过期 registrar 无法污染 Host', async () => {
    const host = new RuntimePluginHost();
    let retained: RuntimePluginRegistrar | undefined;
    host.registerAll([{ manifest: { pluginId: 'acme/retained', version: '1' }, register: (registrar) => {
      retained = registrar;
      registrar.addContextType({ type: 'acme/retained', resolve: async () => ({ snapshot: {} }), materialize: async () => ({}) });
    } }]);
    expect(() => retained!.addContextType({ type: 'acme/late', resolve: async () => ({ snapshot: {} }), materialize: async () => ({}) }))
      .toThrow('registrar is no longer active');
    await expectCode(() => host.getContextType('acme/late'), 'CONTEXT_TYPE_NOT_FOUND');

    expect(() => host.registerAll([{ manifest: { pluginId: 'acme/async', version: '1' }, register: async (registrar) => {
      registrar.addContextType({ type: 'acme/early', resolve: async () => ({ snapshot: {} }), materialize: async () => ({}) });
      await Promise.resolve();
      registrar.addContextType({ type: 'acme/later', resolve: async () => ({ snapshot: {} }), materialize: async () => ({}) });
    } }])).toThrow('must be synchronous');
    await Promise.resolve();
    await expectCode(() => host.getContextType('acme/early'), 'CONTEXT_TYPE_NOT_FOUND');
    await expectCode(() => host.getContextType('acme/later'), 'CONTEXT_TYPE_NOT_FOUND');

    expect(() => host.registerAll([{ manifest: { pluginId: 'acme/rejected', version: '1' }, register: async (registrar) => {
      registrar.addContextType({ type: 'acme/rejected-early', resolve: async () => ({ snapshot: {} }), materialize: async () => ({}) });
      throw new Error('late rejection');
    } }]))
      .toThrow('must be synchronous');
    await Promise.resolve();
    await expectCode(() => host.getContextType('acme/rejected-early'), 'CONTEXT_TYPE_NOT_FOUND');
    expect(host.getContextType('acme/retained')).toBeDefined();
  });

  it('将 replay 普通异常归一化，同时保留既有 RuntimeError', async () => {
    const materializeError = new Error('materialize failed');
    const getterError = new Error('tools getter failed');
    const nameError = new Error('tool name failed');
    const cases: Array<[string, (snapshot: unknown) => Promise<ContextRuntimeContributions>, Error]> = [
      ['throw', async () => { throw materializeError; }, materializeError],
      ['getter', async () => Object.defineProperty({}, 'tools', { get: () => { throw getterError; } }) as ContextRuntimeContributions, getterError],
      ['name', async () => ({ tools: [{ definition: Object.defineProperty({}, 'name', { get: () => { throw nameError; } }), executor: async () => ({ output: '' }) } as RuntimeToolContribution] }), nameError],
    ];
    for (const [type, materialize, cause] of cases) {
      const error = await expectCode(() => new RuntimePluginHost([plugin(type, materialize)]).materializeSnapshot(snapshot(type)), 'CONTEXT_INVALID');
      expect(error.cause).toBe(cause);
    }

    const preserved = new RuntimeError('CONTEXT_UNAUTHORIZED', 'preserve me');
    const preservedError = await expectCode(
      () => new RuntimePluginHost([plugin('preserved', async () => { throw preserved; })]).materializeSnapshot(snapshot('preserved')),
      'CONTEXT_UNAUTHORIZED',
    );
    expect(preservedError).toBe(preserved);

    const conflictHost = new RuntimePluginHost([plugin('conflict', async () => ({ tools: [tool('same')] }))]);
    const conflictSnapshot = snapshot('conflict');
    conflictSnapshot.items.push({ ...conflictSnapshot.items[0]! });
    await expectCode(() => conflictHost.materializeSnapshot(conflictSnapshot), 'CONTEXT_CONFLICT');
    const missingSnapshot = snapshot('conflict');
    missingSnapshot.items[0]!.pluginVersion = '2';
    await expectCode(() => conflictHost.materializeSnapshot(missingSnapshot), 'PLUGIN_DEPENDENCY_MISSING');
  });
});
