import { describe, expect, it } from 'vitest';
import { EventQueue } from '../src/agent/event-queue.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('EventQueue', () => {
  it('单消费者按序收到事件并在 finish 后结束', async () => {
    const q = new EventQueue<number>();
    const done = collect(q);
    q.push(1);
    q.push(2);
    q.finish();
    await expect(done).resolves.toEqual([1, 2]);
  });

  it('多消费者各自收到全量事件', async () => {
    const q = new EventQueue<string>();
    const a = collect(q);
    const b = collect(q);
    q.push('x');
    q.push('y');
    q.finish();
    await expect(a).resolves.toEqual(['x', 'y']);
    await expect(b).resolves.toEqual(['x', 'y']);
  });

  it('后注册的消费者能读到注册前的 backlog', async () => {
    const q = new EventQueue<string>();
    q.push('early');
    const late = collect(q);
    q.push('late');
    q.finish();
    await expect(late).resolves.toEqual(['early', 'late']);
  });
});
