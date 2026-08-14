import { RuntimeError } from '../../../application/runtime/runtime-error.js';
import { InvalidRunCursorError } from '../../../domain/run/run-cursor.js';

interface SqliteFailure { code: string }

export function isSqliteFailure(error: unknown): error is SqliteFailure {
  return typeof error === 'object' && error !== null
    && typeof (error as { code?: unknown }).code === 'string'
    && (error as SqliteFailure).code.startsWith('SQLITE_');
}

export function mapSqliteFailure(error: unknown, action: string): never {
  if (error instanceof InvalidRunCursorError) {
    throw new RuntimeError('INVALID_INPUT', 'Invalid run cursor', false, undefined, { cause: error });
  }
  if (error instanceof RuntimeError) throw error;
  const code = isSqliteFailure(error) ? error.code : undefined;
  const conflict = code?.startsWith('SQLITE_CONSTRAINT') ?? false;
  throw new RuntimeError(
    conflict ? 'STORAGE_CONFLICT' : 'STORAGE_UNAVAILABLE',
    conflict ? `SQLite conflict while ${action}` : `SQLite unavailable while ${action}`,
    code !== undefined && !conflict,
    undefined,
    { cause: error },
  );
}

export function sqliteAction<T>(action: string, operation: () => T): T {
  try { return operation(); }
  catch (error) { return mapSqliteFailure(error, action); }
}

export function corruptRuntimeRow(message: string, cause: unknown): never {
  throw new RuntimeError('STORAGE_UNAVAILABLE', message, false, undefined, { cause });
}

export function runtimeConflict(message: string): never {
  throw new RuntimeError('STORAGE_CONFLICT', message);
}

export function invalidRuntimeInput(message: string, cause?: unknown): never {
  throw new RuntimeError('INVALID_INPUT', message, false, undefined, cause === undefined ? undefined : { cause });
}

export function rejectedRuntimeInput<T>(message: string): Promise<T> {
  const rejected = Promise.reject<T>(new RuntimeError('INVALID_INPUT', message));
  void rejected.catch(() => {});
  return rejected;
}
