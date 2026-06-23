import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ProviderLoader,
  ProviderLoaderContext,
  ProviderReference,
  ProviderDescriptor,
  ProviderModule,
  BuiltinProviderResolver,
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
  constructor(private resolveBuiltin?: BuiltinProviderResolver) {}

  async load<T>(ref: ProviderReference<T>, ctx: ProviderLoaderContext): Promise<T> {
    if (typeof ref !== 'string' && !isDescriptor(ref)) {
      return ref as T;
    }

    const descriptor = typeof ref === 'string' ? { module: ref } : ref;
    const modulePath = this.resolveModulePath(descriptor.module, ctx.kind);
    const mod = await this.importModule<T>(modulePath);

    const options = descriptor.options ?? mod.getDefaultOptions?.(ctx);
    return mod.createProvider(options);
  }

  private resolveModulePath(nameOrPath: string, kind: string): string {
    if (nameOrPath.startsWith('file://')) {
      return fileURLToPath(nameOrPath);
    }

    if (isAbsolute(nameOrPath)) {
      return nameOrPath;
    }

    if (nameOrPath.startsWith('./') || nameOrPath.startsWith('../')) {
      return resolve(process.cwd(), nameOrPath);
    }

    if (this.resolveBuiltin) {
      const builtin = this.resolveBuiltin(kind as any, nameOrPath);
      if (builtin) {
        return builtin;
      }
    }

    throw new Error(
      `Unknown provider "${nameOrPath}" for kind "${kind}". ` +
        `Use an absolute path, a relative path, or a registered builtin name.`,
    );
  }

  private async importModule<T>(path: string): Promise<ProviderModule<T>> {
    const mod = (await import(path)) as Record<string, unknown>;

    if (typeof mod.createProvider === 'function') {
      return mod as unknown as ProviderModule<T>;
    }

    const Constructor = mod.default;
    if (typeof Constructor === 'function') {
      return {
        createProvider: (options: unknown): T => new (Constructor as new (options: unknown) => T)(options),
      };
    }

    throw new Error(
      `Provider module "${path}" must export a "createProvider" function or a default class.`,
    );
  }
}
