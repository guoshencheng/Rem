import type { AgentRun } from '../domain/run/types.js';
import type { RuntimeSessionEntry } from '../domain/session/types.js';
import type { RunExecutionEntry } from '../domain/run/execution-models.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { readNodeJournal } from './run-execution-journal-reader.js';

/** Projects the public, durable part of a Run journal into its Session. */
export function projectRunJournalToSession(
  uow: RuntimeUnitOfWork,
  run: AgentRun,
  at: Date,
  generateId: () => string,
): RuntimeSessionEntry[] {
  const rootNodeId = run.rootNodeId ?? `${run.runId}:root`;
  const executionType = run.executionPlanSnapshot?.executionType ?? run.executionType ?? 'single-agent';
  const journal = readNodeJournal(uow, run.runId, rootNodeId).filter((entry) => entry.message !== undefined);
  const visible = executionType === 'team'
    ? projectTeamEntries(journal)
    : journal.filter(isPublicSessionEntry);
  let sequence = uow.sessions.nextEntrySequence(run.sessionId) - 1;
  return visible.map((entry) => ({
    entryId: generateId(), tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId,
    sequence: ++sequence, message: structuredClone(entry.message!), createdAt: new Date(at.getTime()),
  }));
}

function isPublicSessionEntry(entry: RunExecutionEntry): boolean {
  return entry.audience === 'public' && entry.visibility === 'session' && entry.kind !== 'control';
}

function projectTeamEntries(entries: RunExecutionEntry[]): RunExecutionEntry[] {
  const userEntries = entries.filter((entry) => entry.message?.role === 'user');
  const finalAssistant = [...entries].reverse().find((entry) => entry.message?.role === 'assistant'
    && !isCommunicationEntry(entry)
    && entry.message.stopReason !== 'toolUse'
    && !entry.message.content.some((part) => part.type === 'toolCall'));
  return finalAssistant === undefined ? userEntries : [...userEntries, finalAssistant].sort((a, b) => a.sequence - b.sequence);
}

function isCommunicationEntry(entry: RunExecutionEntry): boolean {
  return typeof entry.data === 'object' && entry.data !== null && !Array.isArray(entry.data)
    && (entry.data as { kind?: unknown }).kind === 'team.communication';
}
