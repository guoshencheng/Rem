import type { ContextBinding, ContextPatch, ContextSet } from './types.js';

const cloneBinding = (binding: ContextBinding): ContextBinding =>
  binding.input === undefined
    ? { ...binding }
    : { ...binding, input: structuredClone(binding.input) };

export function applyContextPatch(base: ContextSet, patch?: ContextPatch): ContextSet {
  const replace = patch?.replace ?? {};
  const replaced = new Set(Object.keys(replace));
  const bindings = base.bindings.filter((binding) => !replaced.has(binding.type));

  for (const [type, values] of Object.entries(replace)) {
    for (const value of values) {
      if (value.type !== type) {
        throw new Error(`Context replacement type mismatch: ${type}`);
      }
      bindings.push({ ...value });
    }
  }

  for (const value of patch?.add ?? []) bindings.push(value);

  const contextIdsByType = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const contextIds = contextIdsByType.get(binding.type);
    if (contextIds?.has(binding.contextId)) {
      throw new Error(`Duplicate context binding: ${binding.type}/${binding.contextId}`);
    }
    if (contextIds) contextIds.add(binding.contextId);
    else contextIdsByType.set(binding.type, new Set([binding.contextId]));
  }

  return { bindings: bindings.map(cloneBinding) };
}
