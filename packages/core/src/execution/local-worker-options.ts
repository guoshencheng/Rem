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

export function resolveWorkerOptions(options: LocalRunWorkerOptions): ResolvedLocalRunWorkerOptions {
  if (!options || typeof options !== 'object') invalid('Worker options are required');
  const owner = typeof options.owner === 'string' ? options.owner.trim() : '';
  if (!owner) invalid('Worker owner must be a non-empty string');
  for (const [name, value] of [
    ['leaseMs', options.leaseMs], ['pollMs', options.pollMs], ['runTimeoutMs', options.runTimeoutMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) invalid(`${name} must be a safe positive integer`);
  }
  if (options.now !== undefined && typeof options.now !== 'function') invalid('now must be a function');
  if (options.generateId !== undefined && typeof options.generateId !== 'function') invalid('generateId must be a function');
  if (options.scheduler !== undefined
    && (typeof options.scheduler.setTimeout !== 'function' || typeof options.scheduler.clearTimeout !== 'function')) {
    invalid('scheduler must provide setTimeout and clearTimeout');
  }
  return {
    owner, leaseMs: options.leaseMs, pollMs: options.pollMs, runTimeoutMs: options.runTimeoutMs,
    now: options.now ?? (() => new Date()), generateId: options.generateId ?? defaultGenerateId,
    scheduler: options.scheduler ?? defaultScheduler,
  };
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
