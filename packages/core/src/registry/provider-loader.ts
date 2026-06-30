import type {
  ProviderLoader,
  ProviderLoaderContext,
  ProviderReference,
  ProviderDescriptor,
  ProviderModule,
  ProviderModuleRef,
} from '../sdk/provider-loader.js';

function isDescriptor<T>(ref: ProviderReference<T>): ref is ProviderDescriptor<T> {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    'module' in ref &&
    typeof (ref as ProviderDescriptor<T>).module === 'string'
  );
}

export class DefaultProviderLoader implements ProviderLoader {
  constructor(private resolveBuiltin?: (kind: string, name: string) => ProviderModuleRef | string | undefined) {}

  async load<T>(ref: ProviderReference<T>, ctx: ProviderLoaderContext): Promise<T> {
    if (typeof ref !== 'string' && !isDescriptor(ref)) {
      return ref as T;
    }

    const descriptor = typeof ref === 'string' ? { module: ref } : ref;
    const name = descriptor.module;
    const kind = ctx.kind;

    const builtinResult = this.resolveBuiltin?.(kind as any, name);
    if (typeof builtinResult === 'function') {
      const mod = await builtinResult();
      const options = descriptor.options ?? (mod as any).getDefaultOptions?.(ctx);
      return mod.createProvider(options);
    }

    throw new Error(
      `Provider "${name}" for kind "${kind}" is not a recognized builtin. ` +
        `Use a ProviderReference instance or register it as a builtin.`,
    );
  }
}
