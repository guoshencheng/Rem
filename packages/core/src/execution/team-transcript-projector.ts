import type { RunExecutionEntry, RunDelivery } from '../domain/run/execution-models.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { readNodeJournal } from './run-execution-journal-reader.js';

/** Builds the immutable model transcript visible to one Team node/delivery. */
export function projectTeamNodeTranscript(
  uow: RuntimeUnitOfWork,
  runId: string,
  nodeId: string,
  delivery: RunDelivery,
): RunExecutionEntry[] {
  const entries = readNodeJournal(uow, runId, nodeId)
    .filter((entry) => !(isCommunicationEntry(entry) && entry.nodeId === nodeId));
  const seen = new Set(entries.map((entry) => entry.entryId));
  const visible = [...entries];
  const deliveries = uow.deliveries.listByNode(runId, nodeId)
    .filter((candidate) => candidate.createdAt.getTime() <= delivery.createdAt.getTime());
  for (const candidate of deliveries) {
    if (candidate.kind === 'message' && candidate.sourceEntryId !== undefined) {
      appendEntry(uow, runId, candidate.sourceEntryId, visible, seen);
    }
    if (candidate.kind === 'resume') {
      for (const source of uow.deliveries.listByBatch(runId, candidate.batchId)) {
        if (source.resultEntryId !== undefined) appendEntry(uow, runId, source.resultEntryId, visible, seen);
      }
    }
  }
  return visible.sort((left, right) => left.sequence - right.sequence || left.entryId.localeCompare(right.entryId));
}

function isCommunicationEntry(entry: RunExecutionEntry): boolean {
  return typeof entry.data === 'object' && entry.data !== null && !Array.isArray(entry.data)
    && (entry.data as { kind?: unknown }).kind === 'team.communication';
}

function appendEntry(
  uow: RuntimeUnitOfWork,
  runId: string,
  entryId: string,
  target: RunExecutionEntry[],
  seen: Set<string>,
): void {
  if (seen.has(entryId)) return;
  const entry = uow.executionEntries.get(entryId);
  if (!entry || entry.runId !== runId || entry.message === undefined) return;
  seen.add(entry.entryId);
  target.push(entry);
}
