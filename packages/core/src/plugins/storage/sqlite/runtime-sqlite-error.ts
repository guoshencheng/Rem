import { RuntimeError } from '../../../application/runtime/runtime-error.js';

interface SqliteFailure { code?: unknown }

export function isSqliteFailure(error: unknown): error is SqliteFailure {
  return typeof error === 'object' && error !== null
    && typeof (error as SqliteFailure).code === 'string'
    && (error as { code: string }).code.startsWith('SQLITE_');
}

export function mapSqliteFailure(error: unknown, action: string): never {
  if (error instanceof RuntimeError) throw error;
  if (!isSqliteFailure(error)) throw error;
  const code = error.code as string;
  const conflict = code.startsWith('SQLITE_CONSTRAINT');
  throw new RuntimeError(
    conflict ? 'STORAGE_CONFLICT' : 'STORAGE_UNAVAILABLE',
    conflict ? `SQLite conflict while ${action}` : `SQLite unavailable while ${action}`,
    !conflict,
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

export function invalidRuntimeInput(message: string): never {
  throw new RuntimeError('INVALID_INPUT', message);
}
