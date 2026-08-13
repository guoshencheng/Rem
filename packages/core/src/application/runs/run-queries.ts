import type { Artifact } from '../../domain/artifact/types.js';
import type { RunEvent } from '../../domain/event/types.js';
import type { AgentRun } from '../../domain/run/types.js';
import type { AgentSession } from '../../domain/session/types.js';
import type { RuntimeStorage } from '../../sdk/runtime-storage.js';
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
