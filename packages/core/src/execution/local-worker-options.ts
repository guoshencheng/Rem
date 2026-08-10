import type { RuntimeErrorCode } from '../application/runtime/runtime-error.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { generateId as defaultGenerateId } from '../shared/generate-id.js';

export interface WorkerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LocalRunWorkerOptions {
  owner: string;
  leaseMs: number;
  pollMs: number;
  runTimeoutMs: number;
  now?: () => Date;
  generateId?: () => string;
  scheduler?: WorkerScheduler;
}

export interface ResolvedLocalRunWorkerOptions {
  owner: string;
  leaseMs: number;
  pollMs: number;
  runTimeoutMs: number;
  now: () => Date;
  generateId: () => string;
  scheduler: WorkerScheduler;
}

const defaultScheduler: WorkerScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

export function resolveWorkerOptions(options: LocalRunWorkerOptions): ResolvedLocalRunWorkerOptions {
  try { return resolveOptions(options as unknown); }
  catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError('INVALID_INPUT', 'Worker options are invalid', false, undefined, { cause: error });
  }
}

function resolveOptions(value: unknown): ResolvedLocalRunWorkerOptions {
  const options = optionsRecord(value);
  const ownerValue = ownValue(options, 'owner');
  const owner = typeof ownerValue === 'string' ? ownerValue.trim() : '';
  if (!owner) invalid('Worker owner must be a non-empty string');
  const leaseMs = positiveInteger(ownValue(options, 'leaseMs'), 'leaseMs');
  const pollMs = positiveInteger(ownValue(options, 'pollMs'), 'pollMs');
  const runTimeoutMs = positiveInteger(ownValue(options, 'runTimeoutMs'), 'runTimeoutMs');
  if (!Number.isFinite(new Date(leaseMs).getTime())) invalid('leaseMs must produce a finite Date duration');
  const now = optionalFunction<() => Date>(ownValue(options, 'now'), 'now') ?? (() => new Date());
  const generateId = optionalFunction<() => string>(ownValue(options, 'generateId'), 'generateId') ?? defaultGenerateId;
  const schedulerValue = ownValue(options, 'scheduler');
  const scheduler = schedulerValue === undefined ? defaultScheduler : normalizeScheduler(schedulerValue);
  if (schedulerValue === undefined && (pollMs > MAX_NODE_TIMER_DELAY_MS || runTimeoutMs > MAX_NODE_TIMER_DELAY_MS)) {
    invalid(`Default scheduler delays cannot exceed ${MAX_NODE_TIMER_DELAY_MS}`);
  }
  return { owner, leaseMs, pollMs, runTimeoutMs, now, generateId, scheduler };
}

function optionsRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Worker options must be a plain object');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) invalid('Worker options cannot contain accessors');
  }
  return value as Record<string, unknown>;
}

function ownValue(options: Record<string, unknown>, property: string): unknown {
  return Object.getOwnPropertyDescriptor(options, property)?.value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid(`${name} must be a safe positive integer`);
  return value as number;
}

function optionalFunction<T extends (...args: never[]) => unknown>(value: unknown, name: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'function') invalid(`${name} must be a function`);
  return value as T;
}

function normalizeScheduler(value: unknown): WorkerScheduler {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    invalid('scheduler must be an object');
  }
  const setTimeoutMethod = dataMethod(value, 'setTimeout');
  const clearTimeoutMethod = dataMethod(value, 'clearTimeout');
  return {
    setTimeout: (callback, delayMs) => setTimeoutMethod.call(value, callback, delayMs),
    clearTimeout: (handle) => { clearTimeoutMethod.call(value, handle); },
  };
}

function dataMethod(value: object | Function, property: string): (...args: unknown[]) => unknown {
  let current: object | null = value;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        invalid(`scheduler.${property} must be a data method`);
      }
      return descriptor.value as (...args: unknown[]) => unknown;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return invalid(`scheduler.${property} must be a function`);
}

export function readWorkerNow(now: () => Date): Date {
  let value: unknown;
  try { value = now(); }
  catch (cause) { throw new RuntimeError('INTERNAL_ERROR', 'Worker clock failed', false, undefined, { cause }); }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid('Worker clock must return a valid Date');
  return new Date(value.getTime());
}

export function nextWorkerId(generateId: () => string): string {
  let value: unknown;
  try { value = generateId(); }
  catch (cause) { throw new RuntimeError('INTERNAL_ERROR', 'Worker ID generation failed', false, undefined, { cause }); }
  if (typeof value !== 'string' || !value.trim()) {
    throw new RuntimeError('INTERNAL_ERROR', 'Worker ID generation returned an invalid ID');
  }
  return value;
}

export function storageFailure(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return new RuntimeError('STORAGE_UNAVAILABLE', 'Runtime storage operation failed', true, undefined, { cause: error });
}

export function executionFailure(error: unknown): { code: RuntimeErrorCode; retryable: boolean } {
  if (error instanceof RuntimeError) return { code: error.code, retryable: error.retryable };
  return { code: 'INTERNAL_ERROR', retryable: false };
}

function invalid(message: string): never {
  throw new RuntimeError('INVALID_INPUT', message);
}
