import type { RunExecutionEntry } from '../domain/run/execution-models.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

const PAGE_SIZE = 500;

export function readNodeJournal(uow: RuntimeUnitOfWork, runId: string, nodeId: string): RunExecutionEntry[] {
  const entries: RunExecutionEntry[] = [];
  let afterSequence = 0;
  for (;;) {
    const page = uow.executionEntries.listByNode(runId, nodeId, afterSequence, PAGE_SIZE);
    entries.push(...page);
    if (page.length < PAGE_SIZE) return entries;
    const next = page.at(-1)?.sequence ?? afterSequence;
    if (!Number.isSafeInteger(next) || next <= afterSequence) throw new RuntimeError('INTERNAL_ERROR', 'Execution journal pagination did not advance');
    afterSequence = next;
  }
}

export function readRunJournal(uow: RuntimeUnitOfWork, runId: string): RunExecutionEntry[] {
  const entries: RunExecutionEntry[] = [];
  let afterSequence = 0;
  for (;;) {
    const page = uow.executionEntries.listByRun(runId, afterSequence, PAGE_SIZE);
    entries.push(...page);
    if (page.length < PAGE_SIZE) return entries;
    const next = page.at(-1)?.sequence ?? afterSequence;
    if (!Number.isSafeInteger(next) || next <= afterSequence) throw new RuntimeError('INTERNAL_ERROR', 'Execution journal pagination did not advance');
    afterSequence = next;
  }
}
