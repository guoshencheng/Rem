import { createHash } from 'node:crypto';

export function cloneCanonicalJson(value: unknown, options?: { omitUndefinedProperties?: boolean }): unknown {
  return canonicalize(value, new WeakSet<object>(), options?.omitUndefinedProperties === true);
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(cloneCanonicalJson(value))).digest('hex');
}

function canonicalize(value: unknown, ancestors: WeakSet<object>, omitUndefinedProperties: boolean): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers are not JSON-compatible');
    return value;
  }
  if (typeof value !== 'object') throw new Error(`Unsupported JSON value: ${typeof value}`);
  if (ancestors.has(value)) throw new Error('Circular JSON value');
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key !== 'length' && (typeof key !== 'string' || !isArrayIndex(key, value.length))) {
        throw new Error('Array properties are not JSON-compatible');
      }
    }
    ancestors.add(value);
    try {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor) throw new Error('Sparse arrays are not JSON-compatible');
        if (!('value' in descriptor)) throw new Error('Accessor properties are not JSON-compatible');
        result.push(canonicalize(descriptor.value, ancestors, omitUndefinedProperties));
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Only plain objects are JSON-compatible');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key)) {
      throw new Error('Non-enumerable or symbol properties are not JSON-compatible');
    }
  }
  ancestors.add(value);
  try {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new Error('Accessor properties are not JSON-compatible');
      // 与 JSON.stringify 一致：值为 undefined 的 own 属性视为缺席（仅显式开启时）。
      if (omitUndefinedProperties && descriptor.value === undefined) continue;
      Object.defineProperty(result, key, {
        value: canonicalize(descriptor.value, ancestors, omitUndefinedProperties),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && String(index) === key && index < length;
}
