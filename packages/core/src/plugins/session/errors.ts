export class UnsupportedSessionSchemaError extends Error {
  constructor(public schemaVersion: number, sessionId: string) {
    super(`Session ${sessionId} uses unsupported schema version ${schemaVersion}. Please migrate or recreate the session.`);
    this.name = 'UnsupportedSessionSchemaError';
  }
}
