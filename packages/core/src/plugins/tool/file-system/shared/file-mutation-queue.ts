import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

function getMutationQueueKey(filePath: string): string {
  const resolvedPath = resolve(filePath);
  try {
    return realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export class FileMutationQueue {
  private queues = new Map<string, Promise<void>>();

  async withQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = getMutationQueueKey(filePath);
    const currentQueue = this.queues.get(key) ?? Promise.resolve();

    let releaseNext!: () => void;
    const nextQueue = new Promise<void>((resolveQueue) => {
      releaseNext = resolveQueue;
    });
    const chainedQueue = currentQueue.then(() => nextQueue);
    this.queues.set(key, chainedQueue);

    await currentQueue;
    try {
      return await fn();
    } finally {
      releaseNext();
      if (this.queues.get(key) === chainedQueue) {
        this.queues.delete(key);
      }
    }
  }
}

export function createFileMutationQueue(): FileMutationQueue {
  return new FileMutationQueue();
}
