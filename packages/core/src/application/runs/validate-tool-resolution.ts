import type { ToolInvocationResolution } from '../../domain/run/execution-models.js';
import type { JsonValue } from '../../domain/json/types.js';
import { cloneCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';

export function validateToolInvocationResolution(value: unknown): ToolInvocationResolution {
  if (!isRecord(value) || typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim()) {
    throw new RuntimeError('INVALID_INPUT', 'A non-empty idempotencyKey is required');
  }
  if (value.action === 'retry' || value.action === 'fail') return {
    action: value.action, idempotencyKey: value.idempotencyKey,
  };
  if (value.action !== 'confirm-succeeded' || !isRecord(value.result) || typeof value.result.output !== 'string') {
    throw new RuntimeError('INVALID_INPUT', 'Tool resolution has an invalid action or result');
  }
  let details: unknown;
  try { details = value.result.details === undefined ? undefined : cloneCanonicalJson(value.result.details); }
  catch (cause) { throw new RuntimeError('INVALID_INPUT', 'Tool resolution details must be canonical JSON', false, undefined, { cause }); }
  const result = { output: value.result.output, ...(details === undefined ? {} : { details: details as JsonValue }) };
  return { action: 'confirm-succeeded', result, idempotencyKey: value.idempotencyKey };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
