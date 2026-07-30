/**
 * 多消费者异步事件队列。
 * - 每个 asyncIterator 独立消费全量事件（含注册前 backlog）。
 * - finish() 后所有消费者自然结束；结束后 push 被忽略。
 * - items 随队列对象被 GC（生命周期与一次 run 绑定）。
 */
export class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters = new Set<() => void>();
  private finished = false;

  push(item: T): void {
    if (this.finished) return;
    this.items.push(item);
    for (const w of [...this.waiters]) w();
  }

  finish(): void {
    this.finished = true;
    for (const w of [...this.waiters]) w();
  }

  get isFinished(): boolean {
    return this.finished;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let cursor = 0;
    while (true) {
      if (cursor < this.items.length) {
        yield this.items[cursor++];
        continue;
      }
      if (this.finished) return;
      await new Promise<void>((resolve) => {
        const w = () => {
          this.waiters.delete(w);
          resolve();
        };
        this.waiters.add(w);
      });
    }
  }
}
