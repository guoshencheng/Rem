import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { JsonSchema, JsonValue } from '../../domain/json/types.js';
import { cloneCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });

export function normalizeJsonSchema(value: unknown, label: string): JsonSchema {
  try {
    const cloned = cloneCanonicalJson(value);
    if (!isRecord(cloned)) throw new TypeError(`${label} must be a plain object`);
    // Compile at the definition boundary so malformed schemas cannot reach a worker.
    ajv.compile(cloned as JsonSchema);
    return cloned as JsonSchema;
  } catch (cause) {
    throw new RuntimeError('INTERNAL_ERROR', `${label} is invalid`, false, undefined, { cause });
  }
}

export function validateJsonSchema(schema: JsonSchema, value: unknown, label = 'input'): unknown {
  let validator: ValidateFunction;
  try { validator = ajv.compile(schema); }
  catch (cause) { throw new RuntimeError('INTERNAL_ERROR', 'Stored JSON Schema is invalid', false, undefined, { cause }); }
  let snapshot: JsonValue | undefined;
  try { snapshot = cloneCanonicalJson(value) as JsonValue; }
  catch (cause) { throw new RuntimeError('INVALID_INPUT', `${label} must be canonical JSON`, false, undefined, { cause }); }
  if (validator(snapshot)) return snapshot;
  const error = validator.errors?.[0];
  throw new RuntimeError('INVALID_INPUT', `${label} does not match schema`, false, {
    pointer: errorPointer(error), keyword: error?.keyword,
  });
}

function errorPointer(error: ErrorObject | undefined): string {
  if (!error) return '';
  if (error.keyword === 'required' && typeof error.params?.missingProperty === 'string') {
    return `${error.instancePath}/${escapePointer(error.params.missingProperty)}`;
  }
  return error.instancePath || '';
}

function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1'); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
