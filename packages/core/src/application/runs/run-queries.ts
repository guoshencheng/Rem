import type { Artifact } from '../../domain/artifact/types.js';
import type { RunEvent } from '../../domain/event/types.js';
import type { AgentRun } from '../../domain/run/types.js';
import type { AgentSession } from '../../domain/session/types.js';
import type { RuntimeStorage } from '../../sdk/runtime-storage.js';
import type { ExecutionEntryListOptions, RunExecutionEntry, RunExecutionNode, RunDelivery, RunListOptions } from '../../domain/run/execution-models.js';
import { RuntimeError } from '../runtime/runtime-error.js';

/**
 * 所有查询先加载资源再校验 tenant；不存在与跨 tenant 统一返回 NOT_FOUND，
 * 避免向调用方泄露资源存在性。
 */
export async function getScopedRun(storage: RuntimeStorage, tenantId: string, runId: string): Promise<AgentRun> {
  const run = await storage.getRun(runId);
  if (!run || run.tenantId !== tenantId) throw new RuntimeError('RUN_NOT_FOUND', 'Run not found');
  return run;
}

export async function getScopedSession(
  storage: RuntimeStorage,
  tenantId: string,
  sessionId: string,
): Promise<AgentSession> {
  const session = await storage.getSession(sessionId);
  if (!session || session.tenantId !== tenantId) throw new RuntimeError('SESSION_NOT_FOUND', 'Session not found');
  return session;
}

export async function listScopedRunEvents(
  storage: RuntimeStorage,
  tenantId: string,
  runId: string,
  afterSequence?: number,
  limit?: number,
): Promise<RunEvent[]> {
  await getScopedRun(storage, tenantId, runId);
  validatePage(afterSequence, limit);
  return storage.listEvents(runId, afterSequence, limit);
}

export async function listScopedRunArtifacts(
  storage: RuntimeStorage,
  tenantId: string,
  runId: string,
): Promise<Artifact[]> {
  await getScopedRun(storage, tenantId, runId);
  return storage.listArtifacts(runId);
}

export async function listScopedRuns(storage: RuntimeStorage, tenantId: string, options?: RunListOptions): Promise<AgentRun[]> {
  return storage.listRuns(tenantId, options);
}

export async function getScopedArtifact(storage: RuntimeStorage, tenantId: string, artifactId: string): Promise<Artifact> {
  const artifact = await storage.getArtifact(artifactId);
  if (!artifact || artifact.tenantId !== tenantId) throw new RuntimeError('RUN_NOT_FOUND', 'Artifact not found');
  return artifact;
}

export async function listScopedExecutionNodes(storage: RuntimeStorage, tenantId: string, runId: string): Promise<RunExecutionNode[]> {
  await getScopedRun(storage, tenantId, runId);
  return storage.listExecutionNodes(runId);
}

export async function listScopedExecutionEntries(storage: RuntimeStorage, tenantId: string, runId: string, options?: ExecutionEntryListOptions): Promise<RunExecutionEntry[]> {
  await getScopedRun(storage, tenantId, runId);
  validatePage(options?.afterSequence, options?.limit);
  return storage.listExecutionEntries(runId, options);
}

export async function listScopedDeliveries(storage: RuntimeStorage, tenantId: string, runId: string): Promise<RunDelivery[]> {
  await getScopedRun(storage, tenantId, runId);
  return storage.listDeliveries(runId);
}

function validatePage(afterSequence: number | undefined, limit: number | undefined): void {
  if (afterSequence !== undefined && (!Number.isSafeInteger(afterSequence) || afterSequence < 0)) {
    throw new RuntimeError('INVALID_INPUT', 'afterSequence must be a non-negative integer');
  }
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) {
    throw new RuntimeError('INVALID_INPUT', 'limit must be an integer between 1 and 1000');
  }
}
