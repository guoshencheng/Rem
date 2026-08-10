import type { ContextBinding, ContextSet, ResolvedContextItem, ResolvedContextSnapshot } from '../../domain/context/types.js';
import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { ContextRuntimeContributions, ResolvedRuntimeContext, RuntimeToolContribution } from '../../sdk/runtime-plugin.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { RuntimePluginHost } from '../../plugin-system/runtime-plugin-host.js';
import { cloneCanonicalJson, hashCanonicalJson } from './canonical-json.js';

export class ContextResolver {
  constructor(private readonly host: RuntimePluginHost) {}

  async resolve(contextSet: ContextSet, request: RuntimeRequestContext): Promise<ResolvedRuntimeContext> {
    return this.normalize(async () => {
      const items: ResolvedContextItem[] = [];
      const configLayers: ResolvedContextSnapshot['configLayers'] = [];
      const promptSections: ResolvedContextSnapshot['promptSections'] = [];
      const tools: RuntimeToolContribution[] = [];
      const names = { config: new Set<string>(), prompt: new Set<string>(), tool: new Set<string>() };

      for (const binding of contextSet.bindings) {
        await this.resolveBinding(binding, request, items, configLayers, promptSections, tools, names);
      }

      configLayers.sort((left, right) => left.priority - right.priority);
      promptSections.sort((left, right) => left.priority - right.priority);
      return { snapshot: { items, configLayers, promptSections }, tools };
    });
  }

  private async resolveBinding(
    binding: ContextBinding,
    request: RuntimeRequestContext,
    items: ResolvedContextItem[],
    configLayers: ResolvedContextSnapshot['configLayers'],
    promptSections: ResolvedContextSnapshot['promptSections'],
    tools: RuntimeToolContribution[],
    names: { config: Set<string>; prompt: Set<string>; tool: Set<string> },
  ): Promise<void> {
    const registered = this.host.getContextType(binding.type);
    const resolution = await registered.contribution.resolve({ binding, request });
    const contribution = await registered.contribution.materialize(resolution.snapshot);
    items.push(this.createItem(binding, registered.pluginId, registered.pluginVersion, resolution.snapshot));
    this.collectContributions(contribution, registered.pluginId, configLayers, promptSections, tools, names);
  }

  private createItem(binding: ContextBinding, pluginId: string, pluginVersion: string, snapshot: unknown): ResolvedContextItem {
    const copiedBinding = cloneCanonicalJson(binding) as ContextBinding;
    const copiedSnapshot = cloneCanonicalJson(snapshot);
    return {
      binding: copiedBinding,
      pluginId,
      pluginVersion,
      snapshot: copiedSnapshot,
      snapshotHash: hashCanonicalJson({ binding: copiedBinding, pluginId, pluginVersion, snapshot: copiedSnapshot }),
    };
  }

  private collectContributions(
    contribution: ContextRuntimeContributions,
    pluginId: string,
    configLayers: ResolvedContextSnapshot['configLayers'],
    promptSections: ResolvedContextSnapshot['promptSections'],
    tools: RuntimeToolContribution[],
    names: { config: Set<string>; prompt: Set<string>; tool: Set<string> },
  ): void {
    for (const layer of contribution.configLayers ?? []) {
      const name = `${pluginId}:${layer.name}`;
      this.assertUnique(names.config, name, 'Config layer');
      configLayers.push({ name, priority: layer.priority, value: this.copySnapshotValue(layer.value) });
    }
    for (const section of contribution.promptSections ?? []) {
      const name = `${pluginId}:${section.name}`;
      this.assertUnique(names.prompt, name, 'Prompt section');
      promptSections.push({ name, priority: section.priority, content: section.content });
    }
    for (const tool of contribution.tools ?? []) {
      this.assertUnique(names.tool, tool.definition.name, 'Tool');
      tools.push(tool);
    }
  }

  private copySnapshotValue(value: unknown): unknown {
    return cloneCanonicalJson(value);
  }

  private assertUnique(names: Set<string>, name: string, label: string): void {
    if (names.has(name)) throw new RuntimeError('CONTEXT_CONFLICT', `${label} already contributed: ${name}`);
    names.add(name);
  }

  private async normalize<T>(action: () => T | Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError('CONTEXT_INVALID', 'Context resolution failed', false, undefined, { cause: error });
    }
  }
}
