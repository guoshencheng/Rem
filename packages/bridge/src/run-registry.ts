const runs = new Map<string, AbortController>();

export const runRegistry = {
  has(sessionId: string): boolean {
    return runs.has(sessionId);
  },

  register(sessionId: string, controller: AbortController): void {
    runs.set(sessionId, controller);
  },

  abort(sessionId: string): boolean {
    const controller = runs.get(sessionId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  },

  remove(sessionId: string): void {
    runs.delete(sessionId);
  },
};
