import type {
  ContextRuntimeContributions,
  ContextTypeContribution,
  RuntimePlugin,
  RuntimeToolContribution,
} from '../src/sdk/runtime-plugin.js';
import type { ContextBinding, ResolvedContextSnapshot } from '../src/domain/context/types.js';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';

const request = { tenantId: 'tenant', principal: { principalId: 'principal', roles: [] } };
function binding(type: string, ...input: [] | [unknown]): ContextBinding {
  const result: ContextBinding = { type, contextId: `${type}-id` };
  if (input.length > 0) result.input = input[0];
  return result;
}

function tool(name: string): RuntimeToolContribution {
  return {
    definition: { name, description: name, parameters: Type.Object({}) },
    executor: async () => ({ output: name }),
  };
}

function plugin(
  pluginId: string,
  version: string,
  type: string,
  options: Partial<ContextTypeContribution> & { dependencies?: readonly string[] } = {},
): RuntimePlugin {
  return {
    manifest: { pluginId, version, dependencies: options.dependencies },
    register: ({ addContextType }) => addContextType({
      type,
      resolve: options.resolve ?? (async ({ binding: item }) => ({ snapshot: item.input ?? { id: item.contextId } })),
      materialize: options.materialize ?? (async () => ({})),
    }),
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

describe('RuntimePluginHost 与 ContextResolver', () => {
  it('按 binding 顺序固化上下文，并稳定排序带前缀的运行贡献', async () => {
    const repository = plugin('acme/repository-plugin', '1.0.0', 'acme/repository', {
      materialize: async (): Promise<ContextRuntimeContributions> => ({
        configLayers: [{ name: 'repository', priority: 2, value: { enabled: true } }],
        promptSections: [{ name: 'repository', priority: 2, content: 'repository' }],
        tools: [tool('repository-tool')],
      }),
    });
    const customer = plugin('acme/customer-plugin', '2.0.0', 'acme/customer', {
      materialize: async (): Promise<ContextRuntimeContributions> => ({
        configLayers: [{ name: 'customer', priority: 1, value: { tier: 'gold' } }],
        promptSections: [{ name: 'customer', priority: 2, content: 'customer' }],
        tools: [tool('customer-tool')],
      }),
    });

    const resolved = await new ContextResolver(new RuntimePluginHost([repository, customer])).resolve(
      { bindings: [binding('acme/repository'), binding('acme/customer')] }, request,
    );

    expect(resolved.snapshot.items.map((item) => item.pluginId)).toEqual([
      'acme/repository-plugin', 'acme/customer-plugin',
    ]);
    expect(resolved.snapshot.items.map((item) => item.binding.type)).toEqual([
      'acme/repository', 'acme/customer',
    ]);
    expect(resolved.snapshot.configLayers.map((item) => item.name)).toEqual([
      'acme/customer-plugin:customer', 'acme/repository-plugin:repository',
    ]);
    expect(resolved.snapshot.promptSections.map((item) => item.name)).toEqual([
      'acme/repository-plugin:repository', 'acme/customer-plugin:customer',
    ]);
    expect(resolved.tools.map((item) => item.definition.name)).toEqual(['repository-tool', 'customer-tool']);
  });

  it('对等价对象产生相同 hash，并保留数组顺序', async () => {
    const resolver = new ContextResolver(new RuntimePluginHost([plugin('acme/plugin', '1', 'acme/type')]));
    const first = await resolver.resolve({ bindings: [binding('acme/type', { b: 2, a: [1, 2] })] }, request);
    const second = await resolver.resolve({ bindings: [binding('acme/type', { a: [1, 2], b: 2 })] }, request);
    const reordered = await resolver.resolve({ bindings: [binding('acme/type', { a: [2, 1], b: 2 })] }, request);

    expect(first.snapshot.items[0]?.snapshotHash).toBe(second.snapshot.items[0]?.snapshotHash);
    expect(first.snapshot.items[0]?.snapshotHash).not.toBe(reordered.snapshot.items[0]?.snapshotHash);
  });

  it('拒绝重复 Context type，且整批注册不会污染既有状态', async () => {
    const host = new RuntimePluginHost([plugin('acme/base', '1', 'acme/base')]);

    expect(() => host.registerAll([
      plugin('acme/new', '1', 'acme/new'),
      plugin('acme/duplicate', '1', 'acme/base'),
    ])).toThrow('Context type already registered');
    await expectCode(() => host.getContextType('acme/new'), 'CONTEXT_TYPE_NOT_FOUND');
    expect(host.getContextType('acme/base').pluginId).toBe('acme/base');
  });

  it('在依赖、插件 ID 和注册失败时保持原子性', async () => {
    const host = new RuntimePluginHost([plugin('acme/base', '1', 'acme/base')]);
    expect(() => host.registerAll([plugin('acme/missing', '1', 'acme/missing', { dependencies: ['absent'] })])).toThrow();
    await expectCode(() => host.getContextType('acme/missing'), 'CONTEXT_TYPE_NOT_FOUND');
    expect(() => host.registerAll([plugin('acme/base', '2', 'acme/other')])).toThrow();
    await expectCode(() => host.getContextType('acme/other'), 'CONTEXT_TYPE_NOT_FOUND');
    expect(() => host.registerAll([{
      manifest: { pluginId: 'acme/broken', version: '1' },
      register: ({ addContextType }) => { addContextType({ type: 'acme/temp', resolve: async () => ({ snapshot: {} }), materialize: async () => ({}) }); throw new Error('broken'); },
    }])).toThrow('broken');
    await expectCode(() => host.getContextType('acme/temp'), 'CONTEXT_TYPE_NOT_FOUND');
    expect(host.getContextType('acme/base').pluginId).toBe('acme/base');
  });

  it('保留授权错误，并将普通解析错误包为 CONTEXT_INVALID', async () => {
    const unauthorized = new RuntimeError('CONTEXT_UNAUTHORIZED', 'denied');
    const host = new RuntimePluginHost([
      plugin('acme/auth', '1', 'acme/auth', { resolve: async () => { throw unauthorized; } }),
      plugin('acme/broken', '1', 'acme/broken', { resolve: async () => { throw new Error('bad snapshot'); } }),
      plugin('acme/materialize', '1', 'acme/materialize', { materialize: async () => { throw new Error('bad contribution'); } }),
    ]);
    const resolver = new ContextResolver(host);

    const authError = await expectCode(() => resolver.resolve({ bindings: [binding('acme/auth')] }, request), 'CONTEXT_UNAUTHORIZED');
    expect(authError).toBe(unauthorized);
    const error = await expectCode(() => resolver.resolve({ bindings: [binding('acme/broken')] }, request), 'CONTEXT_INVALID');
    expect(error.cause).toBeInstanceOf(Error);
    const materializeError = await expectCode(() => resolver.resolve({ bindings: [binding('acme/materialize')] }, request), 'CONTEXT_INVALID');
    expect(materializeError.cause).toBeInstanceOf(Error);
  });

  it('为未知 Context type、同名 config/prompt/tool 贡献返回稳定错误码', async () => {
    const duplicateInputs: Array<ContextRuntimeContributions> = [
      { configLayers: [{ name: 'config', priority: 1, value: {} }] },
      { promptSections: [{ name: 'prompt', priority: 1, content: 'prompt' }] },
      { tools: [tool('duplicate-tool')] },
    ];
    const unknownResolver = new ContextResolver(new RuntimePluginHost());
    await expectCode(() => unknownResolver.resolve({ bindings: [binding('missing')] }, request), 'CONTEXT_TYPE_NOT_FOUND');

    for (const contribution of duplicateInputs) {
      const resolver = new ContextResolver(new RuntimePluginHost([plugin('acme/plugin', '1', 'acme/type', {
        materialize: async () => contribution,
      })]));
      await expectCode(() => resolver.resolve({ bindings: [binding('acme/type'), binding('acme/type')] }, request), 'CONTEXT_CONFLICT');
    }
  });

  it('使用持久化快照重新物化工具，不会再次 resolve', async () => {
    let resolves = 0;
    let materializes = 0;
    const host = new RuntimePluginHost([plugin('acme/plugin', '1', 'acme/type', {
      resolve: async () => ({ snapshot: { stored: ++resolves } }),
      materialize: async (snapshot) => {
        materializes += 1;
        return { tools: [tool(`tool-${(snapshot as { stored: number }).stored}`)] };
      },
    })]);
    const output = await new ContextResolver(host).resolve({ bindings: [binding('acme/type')] }, request);
    const tools = await host.materializeSnapshot(output.snapshot);
    const incompatible: ResolvedContextSnapshot = structuredClone(output.snapshot);
    incompatible.items[0]!.pluginVersion = '2';

    expect(resolves).toBe(1);
    expect(materializes).toBe(2);
    expect(tools.map((item) => item.definition.name)).toEqual(['tool-1']);
    await expectCode(() => host.materializeSnapshot(incompatible), 'PLUGIN_DEPENDENCY_MISSING');
    await expectCode(() => host.materializeSnapshot({ ...output.snapshot, items: [output.snapshot.items[0]!, output.snapshot.items[0]!] }), 'CONTEXT_CONFLICT');
  });

  it('拒绝不可 JSON 序列化与循环快照', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const invalidSnapshots: Array<[string, unknown]> = [
      ['undefined', { value: undefined }],
      ['function', { value: () => 'invalid' }],
      ['symbol', { value: Symbol('invalid') }],
      ['bigint', { value: 1n }],
      ['cycle', circular],
    ];
    const resolver = new ContextResolver(new RuntimePluginHost(invalidSnapshots.map(([name, snapshot]) => (
      plugin(`acme/${name}`, '1', `acme/${name}`, { resolve: async () => ({ snapshot }) })
    ))));

    for (const [name] of invalidSnapshots) {
      const error = await expectCode(() => resolver.resolve({ bindings: [binding(`acme/${name}`)] }, request), 'CONTEXT_INVALID');
      expect(error.cause).toBeInstanceOf(Error);
    }
  });

  it('拒绝 binding 的显式 undefined，并包装贡献 getter 的普通异常', async () => {
    const getterError = new Error('tools getter failed');
    const resolver = new ContextResolver(new RuntimePluginHost([
      plugin('acme/binding', '1', 'acme/binding'),
      plugin('acme/getter', '1', 'acme/getter', {
        materialize: async () => Object.defineProperty({}, 'tools', { get: () => { throw getterError; } }) as ContextRuntimeContributions,
      }),
    ]));

    const bindingError = await expectCode(() => resolver.resolve({ bindings: [binding('acme/binding', undefined)] }, request), 'CONTEXT_INVALID');
    expect(bindingError.cause).toBeInstanceOf(Error);
    const contributionError = await expectCode(() => resolver.resolve({ bindings: [binding('acme/getter')] }, request), 'CONTEXT_INVALID');
    expect(contributionError.cause).toBe(getterError);
  });

  it('拒绝会被静默丢失的贡献字段与数组、对象属性', async () => {
    const lossyArray: unknown[] = [];
    Object.defineProperty(lossyArray, '4294967295', { value: undefined, enumerable: true });
    const hiddenProperty = {};
    Object.defineProperty(hiddenProperty, 'hidden', { value: 'lost', enumerable: false });
    const symbolProperty = {};
    Object.defineProperty(symbolProperty, Symbol('lost'), { value: 'lost', enumerable: true });
    const contributions: Array<[string, ContextRuntimeContributions, unknown]> = [
      ['nan', { configLayers: [{ name: 'bad', priority: Number.NaN, value: {} }] }, {}],
      ['function', { promptSections: [{ name: 'bad', priority: 1, content: (() => 'bad') as unknown as string }] }, {}],
      ['array', { configLayers: [{ name: 'bad', priority: 1, value: lossyArray }] }, {}],
      ['hidden', {}, hiddenProperty],
      ['symbol-key', {}, symbolProperty],
    ];
    const resolver = new ContextResolver(new RuntimePluginHost(contributions.map(([name, contribution, snapshot]) => (
      plugin(`acme/${name}`, '1', `acme/${name}`, {
        resolve: async () => ({ snapshot }),
        materialize: async () => contribution,
      })
    ))));

    for (const [name] of contributions) {
      const error = await expectCode(() => resolver.resolve({ bindings: [binding(`acme/${name}`)] }, request), 'CONTEXT_INVALID');
      expect(error.cause).toBeInstanceOf(Error);
    }
  });
});
