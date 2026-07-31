export class SessionAlreadyRunningError extends Error {
  constructor(sessionId: string) {
    super(`Session "${sessionId}" is already running`);
    this.name = 'SessionAlreadyRunningError';
  }
}
