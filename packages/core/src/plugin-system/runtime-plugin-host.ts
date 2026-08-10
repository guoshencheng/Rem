import type {
  ContextTypeContribution,
  RuntimePlugin,
  RuntimePluginRegistrar,
  RuntimeToolContribution,
} from '../sdk/runtime-plugin.js';
import type { ResolvedContextSnapshot } from '../domain/context/types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

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
      const registrar: RuntimePluginRegistrar = {
        addContextType: (contribution) => {
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
      plugin.register(registrar);
      stagedPlugins.set(manifest.pluginId, { version: manifest.version });
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
    const tools: RuntimeToolContribution[] = [];
    const names = new Set<string>();
    for (const item of snapshot.items) {
      const plugin = this.plugins.get(item.pluginId);
      const registered = this.contexts.get(item.binding.type);
      if (!plugin || plugin.version !== item.pluginVersion || !registered
        || registered.pluginId !== item.pluginId || registered.pluginVersion !== item.pluginVersion) {
        throw new RuntimeError('PLUGIN_DEPENDENCY_MISSING', `Runtime plugin unavailable: ${item.pluginId}@${item.pluginVersion}`);
      }
      const contributions = await registered.contribution.materialize(item.snapshot);
      for (const tool of contributions.tools ?? []) {
        if (names.has(tool.definition.name)) {
          throw new RuntimeError('CONTEXT_CONFLICT', `Tool already contributed: ${tool.definition.name}`);
        }
        names.add(tool.definition.name);
        tools.push(tool);
      }
    }
    return tools;
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
}
