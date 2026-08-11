import type { TObject } from '@sinclair/typebox';
import type { RuntimeToolContribution } from '../sdk/runtime-plugin.js';
import type { ToolDefinition, ToolExecutor } from '../sdk/tool-provider.js';
import { Hint, Kind, Modifier } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { RuntimeError } from '../application/runtime/runtime-error.js';

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
  return {
    name, description, parameters,
    ...(category === undefined ? {} : { category: category as ToolDefinition['category'] }),
    ...(optional<boolean>('dangerous') === undefined ? {} : { dangerous: optional<boolean>('dangerous') }),
    ...(optional<boolean>('readOnly') === undefined ? {} : { readOnly: optional<boolean>('readOnly') }),
    ...(sideEffect === undefined ? {} : { sideEffect: sideEffect as ToolDefinition['sideEffect'] }),
    ...(optional<boolean>('supportsIdempotencyKey') === undefined ? {} : { supportsIdempotencyKey: optional<boolean>('supportsIdempotencyKey') }),
    ...(optional<ToolDefinition['derivePatterns']>('derivePatterns') === undefined ? {} : {
      derivePatterns: (input: never) => optional<ToolDefinition['derivePatterns']>('derivePatterns')!(input),
    }),
    ...(optional<ToolDefinition['deriveAlwaysOptions']>('deriveAlwaysOptions') === undefined ? {} : {
      deriveAlwaysOptions: (input: never) => optional<ToolDefinition['deriveAlwaysOptions']>('deriveAlwaysOptions')!(input),
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
