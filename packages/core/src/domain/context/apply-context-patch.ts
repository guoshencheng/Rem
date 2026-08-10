import type { ContextBinding, ContextPatch, ContextSet } from './types.js';

const keyOf = (binding: ContextBinding): string => `${binding.type}\u0000${binding.contextId}`;

export function applyContextPatch(base: ContextSet, patch?: ContextPatch): ContextSet {
  if (!patch) return { bindings: base.bindings.slice() };

  const replaced = new Set(Object.keys(patch.replace ?? {}));
  const bindings = base.bindings.filter((binding) => !replaced.has(binding.type));

  for (const [type, values] of Object.entries(patch.replace ?? {})) {
    for (const value of values) {
      if (value.type !== type) {
        throw new Error(`Context replacement type mismatch: ${type}`);
      }
      bindings.push({ ...value });
    }
  }

  for (const value of patch.add ?? []) bindings.push({ ...value });

  const keys = new Set<string>();
  for (const binding of bindings) {
    const key = keyOf(binding);
    if (keys.has(key)) {
      throw new Error(`Duplicate context binding: ${binding.type}/${binding.contextId}`);
    }
    keys.add(key);
  }

  return { bindings };
}
