import type { AgentDefinition } from '../../domain/agent-definition/types.js';
import type { ContextBinding, ContextPatch, ContextSet } from '../../domain/context/types.js';
import { applyContextPatch } from '../../domain/context/apply-context-patch.js';
import { RuntimeError } from '../runtime/runtime-error.js';

type RecordValue = Record<string, unknown>;

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
  const overridable = normalizeOverridable(definition.overridableContexts);
  if (patch !== undefined) assertContextPatchShape(patch);
  assertReplacementsAllowed(overridable, patch);

  let result: ContextSet;
  try { result = applyContextPatch(base, patch); }
  catch (cause) {
    throw new RuntimeError('CONTEXT_CONFLICT', 'Context patch conflicts with current contexts', false, undefined, { cause });
  }

  const counts = new Map<string, number>();
  for (const binding of result.bindings) counts.set(binding.type, (counts.get(binding.type) ?? 0) + 1);
  if (definition.requiredContexts !== undefined || definition.optionalContexts !== undefined) {
    for (const type of counts.keys()) {
      if (!constraints.has(type)) throw new RuntimeError('CONTEXT_CONFLICT', `Context type is not declared: ${type}`);
    }
  }
  for (const constraint of constraints.values()) {
    const count = counts.get(constraint.type) ?? 0;
    if (constraint.optional && count === 0) continue;
    if (count < constraint.min) {
      throw new RuntimeError('CONTEXT_REQUIRED', `Context requirement is not met: ${constraint.type}`);
    }
    if (count > constraint.max) {
      throw new RuntimeError('CONTEXT_LIMIT_EXCEEDED', `Context limit is exceeded: ${constraint.type}`);
    }
  }
  return result;
}

export function assertContextPatchShape(value: unknown): asserts value is ContextPatch {
  const patch = requireRecord(value, 'ContextPatch');
  assertAllowedKeys(patch, ['add', 'replace'], 'ContextPatch');
  if (Object.hasOwn(patch, 'add')) {
    if (!Array.isArray(patch.add)) invalid('ContextPatch.add must be an array');
    patch.add.forEach((binding, index) => assertBinding(binding, `ContextPatch.add[${index}]`));
  }
  if (Object.hasOwn(patch, 'replace')) {
    const replace = requireRecord(patch.replace, 'ContextPatch.replace');
    for (const [type, bindings] of Object.entries(replace)) {
      requireNonEmptyText(type, 'ContextPatch.replace type');
      if (!Array.isArray(bindings)) invalid(`ContextPatch.replace.${type} must be an array`);
      bindings.forEach((binding, index) => assertBinding(binding, `ContextPatch.replace.${type}[${index}]`));
    }
  }
}

function assertBinding(value: unknown, label: string): asserts value is ContextBinding {
  const binding = requireRecord(value, label);
  assertAllowedKeys(binding, ['type', 'contextId', 'revision', 'input'], label);
  requireNonEmptyText(binding.type, `${label}.type`);
  requireNonEmptyText(binding.contextId, `${label}.contextId`);
  if (binding.revision !== undefined) requireNonEmptyText(binding.revision, `${label}.revision`);
}

function normalizeConstraints(definition: AgentDefinition): Map<string, NormalizedConstraint> {
  const result = new Map<string, NormalizedConstraint>();
  collect(definition.requiredContexts, 1, false, result, 'requiredContexts');
  collect(definition.optionalContexts, 0, true, result, 'optionalContexts');
  return result;
}

function collect(
  source: unknown,
  defaultMin: number,
  optional: boolean,
  result: Map<string, NormalizedConstraint>,
  label: string,
): void {
  if (source === undefined) return;
  if (!Array.isArray(source)) invalid(`${label} must be an array`);
  source.forEach((raw, index) => {
    const value = requireRecord(raw, `${label}[${index}]`);
    assertAllowedKeys(value, ['type', 'min', 'max'], `${label}[${index}]`);
    const type = requireNonEmptyText(value.type, `${label}[${index}].type`);
    if (result.has(type)) invalid(`Duplicate Context constraint: ${type}`);
    const min = value.min === undefined ? defaultMin : requireCount(value.min, `${label}[${index}].min`);
    const max = value.max === undefined ? Number.POSITIVE_INFINITY : requireCount(value.max, `${label}[${index}].max`);
    if (!optional && min === 0) invalid(`Required Context min must be at least one: ${type}`);
    if (min > max) invalid(`Context constraint min exceeds max: ${type}`);
    result.set(type, { type, min, max, optional });
  });
}

function normalizeOverridable(source: unknown): Set<string> {
  if (source === undefined) return new Set();
  if (!Array.isArray(source)) invalid('overridableContexts must be an array');
  const result = new Set<string>();
  source.forEach((raw, index) => {
    const type = requireNonEmptyText(raw, `overridableContexts[${index}]`);
    if (result.has(type)) invalid(`Duplicate overridable Context: ${type}`);
    result.add(type);
  });
  return result;
}

function assertReplacementsAllowed(allowed: Set<string>, patch?: ContextPatch): void {
  for (const type of Object.keys(patch?.replace ?? {})) {
    if (!allowed.has(type)) throw new RuntimeError('CONTEXT_CONFLICT', `Context type cannot be replaced: ${type}`);
  }
}

function requireRecord(value: unknown, label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label} must be a plain object`);
  return value as RecordValue;
}

function assertAllowedKeys(value: RecordValue, allowed: string[], label: string): void {
  const names = new Set(allowed);
  if (Object.keys(value).some((key) => !names.has(key))) invalid(`${label} has invalid fields`);
}

function requireNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${label} must be a non-empty string`);
  return value;
}

function requireCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${label} must be a finite non-negative integer`);
  return value as number;
}

function invalid(message: string): never {
  throw new RuntimeError('INVALID_INPUT', message);
}
