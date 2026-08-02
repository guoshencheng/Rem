export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency limit must be positive');
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await operation(); } finally { this.release(); }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => {
      this.active += 1;
      resolve();
    }));
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}
