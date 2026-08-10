import { createHash } from 'node:crypto';

export function cloneCanonicalJson(value: unknown): unknown {
  return canonicalize(value, new WeakSet<object>());
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(cloneCanonicalJson(value))).digest('hex');
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): unknown {
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
        if (!Object.hasOwn(value, index)) throw new Error('Sparse arrays are not JSON-compatible');
        result.push(canonicalize(value[index], ancestors));
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
      Object.defineProperty(result, key, {
        value: canonicalize((value as Record<string, unknown>)[key], ancestors),
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
