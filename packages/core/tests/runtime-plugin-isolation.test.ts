import type { ContextResolution, ContextResolutionInput, ContextRuntimeContributions, RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import type { ContextBinding, ContextSet } from '../src/domain/context/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';

const binding = (type: string): ContextBinding => ({ type, contextId: `${type}-id` });
const request = (): RuntimeRequestContext => ({
  tenantId: 'tenant',
  principal: { principalId: 'principal', roles: [], claims: { scope: { allowed: true } } },
});

function plugin(
  pluginId: string,
  type: string,
  resolve: (input: ContextResolutionInput) => Promise<ContextResolution>,
): RuntimePlugin {
  return { manifest: { pluginId, version: '1' }, register: ({ addContextType }) => addContextType({ type, resolve, materialize: async () => ({}) }) };
}

async function expectCode(action: () => unknown | Promise<unknown>): Promise<RuntimeError> {
  try {
    await action();
    throw new Error('Expected an error');
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeError);
    expect((error as RuntimeError).code).toBe('CONTEXT_INVALID');
    return error as RuntimeError;
  }
}

describe('ContextResolver isolation and accessor safety', () => {
  it('隔离 binding、request 与 materialize snapshot，且不影响后续 Context', async () => {
    const contexts: ContextSet = { bindings: [binding('acme/mutate'), binding('acme/later')] };
    const trustedRequest = request();
    const first: RuntimePlugin = {
      manifest: { pluginId: 'acme/mutate', version: '1' },
      register: ({ addContextType }) => addContextType({
        type: 'acme/mutate',
        resolve: async (input) => {
          try { (input.binding as ContextBinding).type = 'changed'; } catch {}
          try { input.request.principal.roles.push('admin'); } catch {}
          try { ((input.request.principal.claims as { scope: { allowed: boolean } }).scope.allowed) = false; } catch {}
          return { snapshot: { stored: true } };
        },
        materialize: async (snapshot) => { (snapshot as { stored: boolean }).stored = false; return {}; },
      }),
    };
    const later = plugin('acme/later', 'acme/later', async (input) => ({ snapshot: { roles: input.request.principal.roles } }));
    const host = new RuntimePluginHost([first, later]);
    const resolved = await new ContextResolver(host).resolve(contexts, trustedRequest);

    expect(contexts.bindings.map((item) => item.type)).toEqual(['acme/mutate', 'acme/later']);
    expect(trustedRequest.principal.roles).toEqual([]);
    expect((trustedRequest.principal.claims as { scope: { allowed: boolean } }).scope.allowed).toBe(true);
    expect(resolved.snapshot.items.map((item) => item.binding.type)).toEqual(['acme/mutate', 'acme/later']);
    expect(resolved.snapshot.items[0]!.snapshot).toEqual({ stored: true });
    expect(resolved.snapshot.items[1]!.snapshot).toEqual({ roles: [] });
    await expect(host.materializeSnapshot(resolved.snapshot)).resolves.toEqual([]);
  });

  it('拒绝对象与数组 accessor，且绝不执行 getter', async () => {
    let objectReads = 0;
    let arrayReads = 0;
    const objectSnapshot = Object.defineProperty({}, 'value', { enumerable: true, get: () => { objectReads += 1; return 'bad'; } });
    const arraySnapshot: unknown[] = [];
    Object.defineProperty(arraySnapshot, '0', { enumerable: true, get: () => { arrayReads += 1; return 'bad'; } });
    const plugins: RuntimePlugin[] = [
      { manifest: { pluginId: 'acme/object', version: '1' }, register: ({ addContextType }) => addContextType({ type: 'acme/object', resolve: async () => ({ snapshot: objectSnapshot }), materialize: async (): Promise<ContextRuntimeContributions> => ({}) }) },
      { manifest: { pluginId: 'acme/array', version: '1' }, register: ({ addContextType }) => addContextType({ type: 'acme/array', resolve: async () => ({ snapshot: arraySnapshot }), materialize: async (): Promise<ContextRuntimeContributions> => ({}) }) },
    ];
    const resolver = new ContextResolver(new RuntimePluginHost(plugins));

    await expectCode(() => resolver.resolve({ bindings: [binding('acme/object')] }, request()));
    await expectCode(() => resolver.resolve({ bindings: [binding('acme/array')] }, request()));
    expect(objectReads).toBe(0);
    expect(arrayReads).toBe(0);
  });
});
