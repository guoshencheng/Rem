import type { RunDelivery, RunExecutionNode } from '../domain/run/execution-models.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';

/** Stable per-run delivery id; node ids may contain separators or user-derived call ids. */
export function runtimeDeliveryId(runId: string, nodeId: string): string {
  return `${runId}:delivery:${encodeURIComponent(nodeId)}`;
}

export function runtimeResumeDeliveryId(runId: string, nodeId: string, batchId?: string): string {
  return batchId === undefined
    ? `${runId}:resume:${encodeURIComponent(nodeId)}`
    : `${runId}:resume:${encodeURIComponent(batchId)}:${encodeURIComponent(nodeId)}`;
}

export function deliveryStatusForNode(status: RunExecutionNode['status']): RunDelivery['status'] {
  if (status === 'queued') return 'queued';
  if (status === 'idle') return 'completed';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'waiting') return 'waiting';
  return 'running';
}

export function updateNodeDelivery(
  uow: RuntimeUnitOfWork,
  runId: string,
  nodeId: string,
  status: RunExecutionNode['status'],
  at: Date,
): void {
  for (const delivery of uow.deliveries.listByRun(runId)) {
    if (delivery.nodeId !== nodeId) continue;
    if (['completed', 'failed', 'cancelled'].includes(delivery.status)) continue;
    uow.deliveries.update({
      ...delivery,
      status: deliveryStatusForNode(status),
      updatedAt: new Date(at.getTime()),
    });
  }
}
