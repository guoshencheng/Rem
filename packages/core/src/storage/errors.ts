export type StorageErrorCode = 'DB_OPEN' | 'DB_QUERY' | 'DB_CONSTRAINT' | 'DB_MIGRATION';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly cause?: unknown;

  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.cause = cause;
    this.name = 'StorageError';
  }
}

export function wrapSqliteError(
  error: unknown,
  code: StorageErrorCode,
  message: string
): StorageError {
  return new StorageError(code, message, error);
}
