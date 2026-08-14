import type { RunExecutionEntry, RunExecutionNode, RunDelivery } from '../domain/run/execution-models.js';

export interface RuntimeExecutionNodeRepository {
  insert(node: RunExecutionNode): void;
  get(nodeId: string): RunExecutionNode | null;
  listByRun(runId: string): RunExecutionNode[];
  update(node: RunExecutionNode): void;
}

export interface RuntimeExecutionEntryRepository {
  append(entry: RunExecutionEntry): void;
  get(entryId: string): RunExecutionEntry | null;
  nextSequence(runId: string): number;
  listByRun(runId: string, afterSequence: number, limit: number): RunExecutionEntry[];
  listByNode(runId: string, nodeId: string, afterSequence: number, limit: number): RunExecutionEntry[];
}

export interface RuntimeDeliveryRepository {
  insert(delivery: RunDelivery): void;
  get(deliveryId: string): RunDelivery | null;
  listByRun(runId: string): RunDelivery[];
  listByBatch(runId: string, batchId: string): RunDelivery[];
  listByNode(runId: string, nodeId: string): RunDelivery[];
  /** Atomically changes one queued delivery to running and increments attempt. */
  claimQueued(runId: string, deliveryId: string, now: Date): RunDelivery | null;
  update(delivery: RunDelivery): void;
}
