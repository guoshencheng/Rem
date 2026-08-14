import type { ContextPatch } from '../../domain/context/types.js';
import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { AgentSession } from '../../domain/session/types.js';
import type { RuntimeStorage } from '../../sdk/runtime-storage.js';
import { applyContextPatch } from '../../domain/context/apply-context-patch.js';
import { assertContextPatchShape } from '../runs/validate-run-contexts.js';
import { RuntimeError } from '../runtime/runtime-error.js';

export async function patchSessionContexts(
  storage: RuntimeStorage,
  request: RuntimeRequestContext,
  sessionId: string,
  patch: ContextPatch,
  expectedVersion: number,
): Promise<AgentSession> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new RuntimeError('INVALID_INPUT', 'expectedVersion must be a non-negative integer');
  }
  assertContextPatchShape(patch);
  return storage.transaction((uow) => {
    const current = uow.sessions.get(sessionId);
    if (!current || current.tenantId !== request.tenantId) throw new RuntimeError('SESSION_NOT_FOUND', 'Session not found');
    const version = current.version ?? 0;
    if (version !== expectedVersion) {
      throw new RuntimeError('RUN_CONFLICT', 'Session context version changed', false, { expectedVersion, actualVersion: version });
    }
    let contexts: AgentSession['contexts'];
    try { contexts = applyContextPatch(current.contexts, patch); }
    catch (cause) { throw new RuntimeError('CONTEXT_CONFLICT', 'Invalid session context patch', false, undefined, { cause }); }
    const now = new Date();
    const updated: AgentSession = { ...current, contexts, version: version + 1, updatedAt: now };
    uow.sessions.update(updated);
    return structuredClone(updated);
  });
}
