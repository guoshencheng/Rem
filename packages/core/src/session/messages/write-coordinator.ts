export class SessionWriteCoordinator {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.tails.set(sessionId, current);
    void current.finally(() => {
      if (this.tails.get(sessionId) === current) this.tails.delete(sessionId);
    }).catch(() => undefined);
    return current;
  }
}
