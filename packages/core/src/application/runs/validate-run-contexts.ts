import type { AgentDefinition, ContextTypeConstraint } from '../../domain/agent-definition/types.js';
import type { ContextPatch, ContextSet } from '../../domain/context/types.js';
import { applyContextPatch } from '../../domain/context/apply-context-patch.js';
import { RuntimeError } from '../runtime/runtime-error.js';

interface NormalizedConstraint {
  type: string;
  min: number;
  max: number;
  optional: boolean;
}

export function validateRunContexts(
  definition: AgentDefinition,
  base: ContextSet,
  patch?: ContextPatch,
): ContextSet {
  const constraints = normalizeConstraints(definition);
  assertReplacementsAllowed(definition, patch);
  let result: ContextSet;
  try {
    result = applyContextPatch(base, patch);
  } catch (cause) {
    throw new RuntimeError('CONTEXT_CONFLICT', 'Context patch conflicts with the current contexts', false, undefined, { cause });
  }

  const counts = new Map<string, number>();
  for (const binding of result.bindings) counts.set(binding.type, (counts.get(binding.type) ?? 0) + 1);
  if (definition.requiredContexts !== undefined || definition.optionalContexts !== undefined) {
    for (const type of counts.keys()) {
      if (!constraints.has(type)) throw new RuntimeError('CONTEXT_INVALID', `Context type is not declared: ${type}`);
    }
  }
  for (const constraint of constraints.values()) {
    const count = counts.get(constraint.type) ?? 0;
    if (constraint.optional && count === 0) continue;
    if (count < constraint.min || count > constraint.max) {
      throw new RuntimeError('CONTEXT_INVALID', `Context count is invalid: ${constraint.type}`);
    }
  }
  return result;
}

function normalizeConstraints(definition: AgentDefinition): Map<string, NormalizedConstraint> {
  const result = new Map<string, NormalizedConstraint>();
  collect(definition.requiredContexts, 1, false, result);
  collect(definition.optionalContexts, 0, true, result);
  return result;
}

function collect(
  values: readonly ContextTypeConstraint[] | undefined,
  defaultMin: number,
  optional: boolean,
  result: Map<string, NormalizedConstraint>,
): void {
  for (const value of values ?? []) {
    if (typeof value.type !== 'string' || !value.type.trim() || result.has(value.type)) {
      throw new RuntimeError('INVALID_INPUT', `Invalid or duplicate Context constraint: ${String(value.type)}`);
    }
    const min = value.min ?? defaultMin;
    const max = value.max ?? Number.POSITIVE_INFINITY;
    if (!Number.isInteger(min) || min < 0
      || value.max !== undefined && (!Number.isInteger(max) || max < 0)
      || min > max) {
      throw new RuntimeError('INVALID_INPUT', `Invalid Context constraint range: ${value.type}`);
    }
    result.set(value.type, { type: value.type, min, max, optional });
  }
}

function assertReplacementsAllowed(definition: AgentDefinition, patch?: ContextPatch): void {
  const allowed = new Set(definition.overridableContexts ?? []);
  for (const type of Object.keys(patch?.replace ?? {})) {
    if (!allowed.has(type)) throw new RuntimeError('CONTEXT_CONFLICT', `Context type cannot be replaced: ${type}`);
  }
}
