const globalKey = Symbol.for('rem.run-registry');

function createRunRegistry() {
  const runs = new Map<string, AbortController>();

  return {
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
}

export const runRegistry: ReturnType<typeof createRunRegistry> =
  (globalThis as Record<symbol, ReturnType<typeof createRunRegistry>>)[globalKey]
  ?? ((globalThis as Record<symbol, ReturnType<typeof createRunRegistry>>)[globalKey] = createRunRegistry());
