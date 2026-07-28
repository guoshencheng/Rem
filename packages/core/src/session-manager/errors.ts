export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super('Session not found');
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }

  public readonly sessionId: string;
}
