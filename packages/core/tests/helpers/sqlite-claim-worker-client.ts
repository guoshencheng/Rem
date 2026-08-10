import type { WorkItem } from '../../src/domain/run/types.js';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

type ClaimWorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; value: WorkItem | null }
  | { type: 'error'; error: { name: string; message: string; code?: string } };

export interface ClaimWorkerOptions {
  mode?: 'claim' | 'exit-before-result';
  timeoutMs?: number;
}

const tsxLoader = createRequire(import.meta.url).resolve('tsx');

export function createClaimWorker(dbPath: string, owner: string, gate: SharedArrayBuffer, options: ClaimWorkerOptions = {}) {
  const worker = new Worker(new URL('./sqlite-claim-worker.ts', import.meta.url), {
    workerData: { dbPath, owner, gate, mode: options.mode ?? 'claim' },
    execArgv: ['--import', tsxLoader],
  });
  let readySettled = false; let resultSettled = false; let exited = false;
  let readyResolve!: () => void; let readyReject!: (error: Error) => void;
  let resultResolve!: (value: WorkItem | null) => void; let resultReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise<WorkItem | null>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  void result.catch(() => {});

  const fail = (error: Error) => {
    if (!readySettled) { readySettled = true; readyReject(error); }
    if (!resultSettled) { resultSettled = true; resultReject(error); }
  };
  const onMessage = (message: ClaimWorkerMessage) => {
    if (message.type === 'ready' && !readySettled) { readySettled = true; readyResolve(); }
    if (message.type === 'result' && !resultSettled) { resultSettled = true; resultResolve(message.value); }
    if (message.type === 'error') fail(new Error(`${message.error.name}${message.error.code ? ` [${message.error.code}]` : ''}: ${message.error.message}`));
  };
  const onError = (error: Error) => fail(error);
  const cleanup = () => {
    clearTimeout(timeout); worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit);
  };
  const onExit = (code: number) => {
    exited = true;
    if (!resultSettled) fail(new Error(`Claim worker exited before result with code ${code}`));
    cleanup();
  };
  const timeout = setTimeout(() => {
    fail(new Error(`Claim worker timed out after ${options.timeoutMs ?? 10_000}ms`));
    void worker.terminate();
  }, options.timeoutMs ?? 10_000);
  worker.on('message', onMessage); worker.once('error', onError); worker.once('exit', onExit);

  return {
    ready,
    result,
    async terminate() { if (!exited) await worker.terminate(); cleanup(); },
  };
}
