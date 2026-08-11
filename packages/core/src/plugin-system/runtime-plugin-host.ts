import type {
  ContextTypeContribution,
  RuntimePlugin,
  RuntimePluginRegistrar,
  RuntimeToolContribution,
} from '../sdk/runtime-plugin.js';
import type { ResolvedContextSnapshot } from '../domain/context/types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';

export interface RegisteredContextType {
  pluginId: string;
  pluginVersion: string;
  contribution: ContextTypeContribution;
}

interface RegisteredPlugin {
  version: string;
}

export class RuntimePluginHost {
  private plugins = new Map<string, RegisteredPlugin>();
  private contexts = new Map<string, RegisteredContextType>();

  constructor(plugins: readonly RuntimePlugin[] = []) {
    this.registerAll(plugins);
  }

  registerAll(plugins: readonly RuntimePlugin[]): void {
    this.validatePlugins(plugins);
    const stagedPlugins = new Map(this.plugins);
    const stagedContexts = new Map(this.contexts);

    for (const plugin of plugins) {
      const manifest = plugin.manifest;
      let active = true;
      const registrar: RuntimePluginRegistrar = {
        addContextType: (contribution) => {
          if (!active) throw new Error(`Runtime plugin registrar is no longer active: ${manifest.pluginId}`);
          if (!contribution.type.trim()) {
            throw new Error('Context type must not be empty');
          }
          if (stagedContexts.has(contribution.type)) {
            throw new Error(`Context type already registered: ${contribution.type}`);
          }
          stagedContexts.set(contribution.type, {
            pluginId: manifest.pluginId,
            pluginVersion: manifest.version,
            contribution,
          });
        },
      };
      try {
        const result = (plugin.register as (registrar: RuntimePluginRegistrar) => unknown)(registrar);
        if (isThenable(result)) {
          void Promise.resolve(result).catch(() => undefined);
          throw new Error(`Runtime plugin register must be synchronous: ${manifest.pluginId}`);
        }
        stagedPlugins.set(manifest.pluginId, { version: manifest.version });
      } finally {
        active = false;
      }
    }

    this.plugins = stagedPlugins;
    this.contexts = stagedContexts;
  }

  getContextType(type: string): RegisteredContextType {
    const registered = this.contexts.get(type);
    if (!registered) {
      throw new RuntimeError('CONTEXT_TYPE_NOT_FOUND', `Context type not found: ${type}`);
    }
    return registered;
  }

  async materializeSnapshot(snapshot: ResolvedContextSnapshot): Promise<RuntimeToolContribution[]> {
    return this.normalizeMaterialization(async () => {
      const tools: RuntimeToolContribution[] = [];
      const names = new Set<string>();
      for (const item of snapshot.items) {
        const plugin = this.plugins.get(item.pluginId);
        const registered = this.contexts.get(item.binding.type);
        if (!plugin || plugin.version !== item.pluginVersion || !registered
          || registered.pluginId !== item.pluginId || registered.pluginVersion !== item.pluginVersion) {
          throw new RuntimeError('PLUGIN_DEPENDENCY_MISSING', `Runtime plugin unavailable: ${item.pluginId}@${item.pluginVersion}`);
        }
        const contributions = await registered.contribution.materialize(cloneCanonicalJson(item.snapshot));
        for (const tool of contributions.tools ?? []) {
          const name = readToolName(tool);
          if (names.has(name)) throw new RuntimeError('CONTEXT_CONFLICT', `Tool already contributed: ${name}`);
          names.add(name);
          tools.push(tool);
        }
      }
      return tools;
    });
  }

  private validatePlugins(plugins: readonly RuntimePlugin[]): void {
    const knownIds = new Set(this.plugins.keys());
    const batchIds = new Set<string>();
    for (const plugin of plugins) {
      const { pluginId, version } = plugin.manifest;
      if (!pluginId.trim()) throw new Error('Runtime plugin ID must not be empty');
      if (!version.trim()) throw new Error(`Runtime plugin version must not be empty: ${pluginId}`);
      if (knownIds.has(pluginId) || batchIds.has(pluginId)) {
        throw new Error(`Runtime plugin already registered: ${pluginId}`);
      }
      batchIds.add(pluginId);
    }
    for (const plugin of plugins) {
      for (const dependency of plugin.manifest.dependencies ?? []) {
        if (!knownIds.has(dependency) && !batchIds.has(dependency)) {
          throw new Error(`Runtime plugin dependency missing: ${plugin.manifest.pluginId} -> ${dependency}`);
        }
      }
    }
  }

  private async normalizeMaterialization<T>(action: () => T | Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError('CONTEXT_INVALID', 'Context materialization failed', false, undefined, { cause: error });
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    && typeof (value as { then?: unknown }).then === 'function';
}

function readToolName(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid runtime tool contribution');
  const definitionDescriptor = Object.getOwnPropertyDescriptor(value, 'definition');
  if (!definitionDescriptor || !('value' in definitionDescriptor)) throw new Error('Invalid runtime tool definition');
  const definition = definitionDescriptor.value;
  if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) throw new Error('Invalid runtime tool definition');
  const nameDescriptor = Object.getOwnPropertyDescriptor(definition, 'name');
  if (!nameDescriptor || !('value' in nameDescriptor) || typeof nameDescriptor.value !== 'string' || !nameDescriptor.value.trim()) {
    throw new Error('Invalid runtime tool name');
  }
  return nameDescriptor.value;
}
