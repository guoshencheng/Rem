import type { TObject } from '@sinclair/typebox';
import type { RuntimeToolContribution } from '../../sdk/runtime-plugin.js';
import type { ToolDefinition, ToolExecutor } from '../../sdk/tool-provider.js';
import { Hint, Kind, Modifier } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { RuntimeError } from '../runtime/runtime-error.js';
import { cloneCanonicalJson } from './canonical-json.js';

const DEFINITION_KEYS = new Set([
  'name', 'description', 'parameters', 'category', 'dangerous', 'readOnly', 'sideEffect',
  'supportsIdempotencyKey', 'derivePatterns', 'deriveAlwaysOptions',
]);

export function normalizeRuntimeToolContribution(value: unknown): RuntimeToolContribution {
  try {
    const contribution = plainRecord(value, 'tool contribution');
    assertOnlyKeys(contribution, new Set(['definition', 'executor']));
    const definitionValue = dataProperty(contribution, 'definition');
    const executor = dataProperty(contribution, 'executor');
    if (typeof executor !== 'function') throw new Error('Tool executor must be a function');
    const invoke = executor as ToolExecutor;
    return { definition: normalizeDefinition(definitionValue), executor: (input, context) => invoke(input, context) };
  } catch (cause) {
    throw new RuntimeError('CONTEXT_INVALID', 'Runtime plugin returned an invalid tool definition', false, undefined, { cause });
  }
}

function normalizeDefinition(value: unknown): ToolDefinition {
  const record = plainRecord(value, 'tool definition');
  assertOnlyKeys(record, DEFINITION_KEYS);
  const name = nonEmpty(dataProperty(record, 'name'), 'name');
  const description = nonEmpty(dataProperty(record, 'description'), 'description');
  const parameters = cloneSchema(dataProperty(record, 'parameters')) as TObject;
  TypeCompiler.Compile(parameters);
  const optional = <T>(key: string): T | undefined => dataProperty(record, key) as T | undefined;
  const category = optional<string>('category');
  if (category !== undefined && !['filesystem', 'shell', 'search'].includes(category)) throw new Error('Invalid tool category');
  const sideEffect = optional<string>('sideEffect');
  if (sideEffect !== undefined && !['none', 'idempotent', 'non-idempotent'].includes(sideEffect)) throw new Error('Invalid sideEffect');
  for (const key of ['dangerous', 'readOnly', 'supportsIdempotencyKey']) {
    const current = optional(key);
    if (current !== undefined && typeof current !== 'boolean') throw new Error(`${key} must be boolean`);
  }
  for (const key of ['derivePatterns', 'deriveAlwaysOptions']) {
    const current = optional(key);
    if (current !== undefined && typeof current !== 'function') throw new Error(`${key} must be a function`);
  }
  const dangerous = optional<boolean>('dangerous');
  const readOnly = optional<boolean>('readOnly');
  const supportsIdempotencyKey = optional<boolean>('supportsIdempotencyKey');
  const derivePatterns = optional<ToolDefinition['derivePatterns']>('derivePatterns');
  const deriveAlwaysOptions = optional<ToolDefinition['deriveAlwaysOptions']>('deriveAlwaysOptions');
  return {
    name, description, parameters,
    ...(category === undefined ? {} : { category: category as ToolDefinition['category'] }),
    ...(dangerous === undefined ? {} : { dangerous }),
    ...(readOnly === undefined ? {} : { readOnly }),
    ...(sideEffect === undefined ? {} : { sideEffect: sideEffect as ToolDefinition['sideEffect'] }),
    ...(supportsIdempotencyKey === undefined ? {} : { supportsIdempotencyKey }),
    ...(derivePatterns === undefined ? {} : {
      derivePatterns: (input: never) => normalizePatterns(derivePatterns.call(undefined, cloneJson(input))),
    }),
    ...(deriveAlwaysOptions === undefined ? {} : {
      deriveAlwaysOptions: (input: never) => normalizeAlwaysOptions(deriveAlwaysOptions.call(undefined, cloneJson(input))),
    }),
  } as ToolDefinition;
}

function cloneSchema(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Invalid tool schema value');
  if (Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) throw new Error('Tool schema must contain plain objects');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const key of Reflect.ownKeys(value)) if (key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key))) throw new Error('Invalid array property');
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new Error('Sparse schema arrays are invalid');
      }
      return value.map((item) => cloneSchema(item, ancestors));
    }
    const output: Record<PropertyKey, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol' && key !== Kind && key !== Modifier && key !== Hint) throw new Error('Unknown schema symbol');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Hidden or accessor schema properties are invalid');
      Object.defineProperty(output, key, { value: cloneSchema(descriptor.value, ancestors), enumerable: true, writable: true, configurable: true });
    }
    return output;
  } finally { ancestors.delete(value); }
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error(`${label} has symbols`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error(`${label} has hidden or accessor properties`);
  }
  return value as Record<string, unknown>;
}
function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !('value' in descriptor)) throw new Error(`${key} must be an enumerable data property`);
  return descriptor.value;
}
function assertOnlyKeys(record: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`Unknown property: ${key}`);
}
function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
}

function cloneJson<T>(value: T): T {
  try { return cloneCanonicalJson(value) as T; }
  catch (cause) { throw new RuntimeError('CONTEXT_INVALID', 'Tool derive function used an invalid value', false, undefined, { cause }); }
}

function normalizePatterns(value: unknown): string[] {
  const cloned = cloneJson(value);
  if (!Array.isArray(cloned) || cloned.some((pattern) => typeof pattern !== 'string' || !pattern.trim())) {
    throw new RuntimeError('CONTEXT_INVALID', 'Tool derivePatterns returned an invalid result');
  }
  return cloned as string[];
}

function normalizeAlwaysOptions(value: unknown): ReturnType<NonNullable<ToolDefinition['deriveAlwaysOptions']>> {
  const cloned = cloneJson(value);
  if (!Array.isArray(cloned) || cloned.some((option) => {
    if (typeof option !== 'object' || option === null || Array.isArray(option)) return true;
    const record = option as Record<string, unknown>;
    const rule = record.rule;
    return Object.keys(record).some((key) => key !== 'label' && key !== 'rule')
      || typeof record.label !== 'string' || !record.label.trim()
      || typeof rule !== 'object' || rule === null || Array.isArray(rule)
      || Object.keys(rule).some((key) => !['permission', 'pattern', 'action', 'outside'].includes(key))
      || typeof (rule as Record<string, unknown>).permission !== 'string' || !(rule as Record<string, string>).permission.trim()
      || typeof (rule as Record<string, unknown>).pattern !== 'string' || !(rule as Record<string, string>).pattern.trim()
      || !['allow', 'deny', 'ask'].includes((rule as Record<string, unknown>).action as string)
      || ((rule as Record<string, unknown>).outside !== undefined && typeof (rule as Record<string, unknown>).outside !== 'boolean');
  })) throw new RuntimeError('CONTEXT_INVALID', 'Tool deriveAlwaysOptions returned an invalid result');
  return cloned as ReturnType<NonNullable<ToolDefinition['deriveAlwaysOptions']>>;
}
