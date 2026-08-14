export interface RunCursor {
  createdAt: string;
  runId: string;
}

export class InvalidRunCursorError extends Error {
  constructor(options?: ErrorOptions) {
    super('Invalid run cursor', options);
    this.name = 'InvalidRunCursorError';
  }
}

export function encodeRunCursor(cursor: RunCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeRunCursor(value: string): RunCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<RunCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.runId !== 'string' || !parsed.runId) throw new Error('invalid cursor');
    const date = new Date(parsed.createdAt);
    if (date.toISOString() !== parsed.createdAt) throw new Error('invalid cursor date');
    return { createdAt: parsed.createdAt, runId: parsed.runId };
  } catch (cause) { throw new InvalidRunCursorError({ cause }); }
}
