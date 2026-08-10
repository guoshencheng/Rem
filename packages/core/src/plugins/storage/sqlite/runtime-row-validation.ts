import { RuntimeError } from '../../../application/runtime/runtime-error.js';
import { corruptRuntimeRow } from './runtime-sqlite-error.js';

type RecordValue = Record<string, unknown>;

const fail = (column: string, expectation: string, value: unknown): never =>
  corruptRuntimeRow(`Invalid ${column}`, new TypeError(`${column} must be ${expectation}; received ${String(value)}`));

export function runtimeText(value: unknown, column: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) return fail(column, allowEmpty ? 'a string' : 'a non-empty string', value);
  return value;
}

export function runtimeOptionalText(value: unknown, column: string, allowEmpty = false): string | undefined {
  if (value === null) return undefined;
  return runtimeText(value, column, allowEmpty);
}

export function runtimeEnum<T extends string>(value: unknown, column: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail(column, `one of ${values.join(', ')}`, value);
  return value as T;
}

export function runtimeOptionalEnum<T extends string>(value: unknown, column: string, values: readonly T[]): T | undefined {
  if (value === null) return undefined;
  return runtimeEnum(value, column, values);
}

export function runtimeInteger(value: unknown, column: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) return fail(column, `an integer >= ${minimum}`, value);
  return value as number;
}

export function runtimeIntegerEnum<T extends number>(value: unknown, column: string, values: readonly T[]): T {
  if (!Number.isSafeInteger(value) || !values.includes(value as T)) return fail(column, `one of ${values.join(', ')}`, value);
  return value as T;
}

export function runtimeBoolean(value: unknown, column: string): boolean {
  if (value !== 0 && value !== 1) return fail(column, '0 or 1', value);
  return value === 1;
}

export function runtimeFiniteNumber(value: unknown, column: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(column, 'a finite number', value);
  return value;
}

export function runtimeDate(value: unknown, column: string): Date {
  if (typeof value !== 'string') return fail(column, 'a canonical ISO date', value);
  let parsed: Date;
  try {
    parsed = new Date(value);
    if (parsed.toISOString() === value) return parsed;
  } catch (error) { return corruptRuntimeRow(`Invalid ${column}`, error); }
  return fail(column, 'a canonical ISO date', value);
}

export function runtimeOptionalDate(value: unknown, column: string): Date | undefined {
  if (value === null) return undefined;
  return runtimeDate(value, column);
}

export function runtimeJson<T>(value: unknown, column: string, validate?: (parsed: unknown, column: string) => void): T {
  if (typeof value !== 'string') return fail(column, 'JSON text', value);
  try {
    const parsed: unknown = JSON.parse(value);
    validate?.(parsed, column);
    return parsed as T;
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    return corruptRuntimeRow(`Invalid JSON in ${column}`, error);
  }
}

export function requirePlainObject(value: unknown, column: string): asserts value is RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(column, 'a plain object', value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(column, 'a plain object', value);
}

function requireArray(value: unknown, column: string): asserts value is unknown[] {
  if (!Array.isArray(value)) return fail(column, 'an array', value);
}

export function validateContextSet(value: unknown, column: string): void {
  requirePlainObject(value, column);
  const { bindings } = value;
  requireArray(bindings, `${column}.bindings`);
  bindings.forEach((binding, index) => validateBinding(binding, `${column}.bindings[${index}]`));
}

function validateBinding(value: unknown, column: string): void {
  requirePlainObject(value, column);
  runtimeText(value.type, `${column}.type`); runtimeText(value.contextId, `${column}.contextId`);
  if (Object.hasOwn(value, 'revision')) runtimeText(value.revision, `${column}.revision`, true);
}

export function validateTrigger(value: unknown, column: string): void {
  requirePlainObject(value, column);
  const type = runtimeEnum(value.type, `${column}.type`, ['message', 'task'] as const);
  const property = type === 'message' ? 'content' : 'input';
  if (!Object.hasOwn(value, property)) fail(column, `an object with ${property}`, value);
}

export function validateContextSnapshot(value: unknown, column: string): void {
  requirePlainObject(value, column);
  const { items, configLayers, promptSections } = value;
  requireArray(items, `${column}.items`);
  requireArray(configLayers, `${column}.configLayers`);
  requireArray(promptSections, `${column}.promptSections`);
  items.forEach((item, index) => {
    const itemColumn = `${column}.items[${index}]`; requirePlainObject(item, itemColumn);
    validateBinding(item.binding, `${itemColumn}.binding`);
    runtimeText(item.pluginId, `${itemColumn}.pluginId`); runtimeText(item.pluginVersion, `${itemColumn}.pluginVersion`);
    if (typeof item.snapshotHash !== 'string' || !/^[0-9a-f]{64}$/i.test(item.snapshotHash)) fail(`${itemColumn}.snapshotHash`, '64 hexadecimal characters', item.snapshotHash);
    if (!Object.hasOwn(item, 'snapshot')) fail(itemColumn, 'an object with snapshot', item);
  });
  configLayers.forEach((layer, index) => {
    const layerColumn = `${column}.configLayers[${index}]`; requirePlainObject(layer, layerColumn);
    runtimeText(layer.name, `${layerColumn}.name`); runtimeFiniteNumber(layer.priority, `${layerColumn}.priority`);
    if (!Object.hasOwn(layer, 'value')) fail(layerColumn, 'an object with value', layer);
  });
  promptSections.forEach((section, index) => {
    const sectionColumn = `${column}.promptSections[${index}]`; requirePlainObject(section, sectionColumn);
    runtimeText(section.name, `${sectionColumn}.name`); runtimeFiniteNumber(section.priority, `${sectionColumn}.priority`);
    runtimeText(section.content, `${sectionColumn}.content`, true);
  });
}

export function validateMessage(value: unknown, column: string): void {
  requirePlainObject(value, column);
  const role = runtimeEnum(value.role, `${column}.role`, ['user', 'assistant', 'toolResult'] as const);
  if (!Object.hasOwn(value, 'content')) fail(column, 'an object with content', value);
  runtimeFiniteNumber(value.timestamp, `${column}.timestamp`);
  if (role === 'toolResult') {
    runtimeText(value.toolCallId, `${column}.toolCallId`); runtimeText(value.toolName, `${column}.toolName`);
    if (typeof value.isError !== 'boolean') fail(`${column}.isError`, 'a boolean', value.isError);
  }
}
