import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { StartRunInput } from './types.js';
import { hashCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';

export function hashStartRunRequest(request: RuntimeRequestContext, input: StartRunInput): string {
  try {
    return hashCanonicalJson({
      tenantId: request.tenantId,
      principalId: request.principal.principalId,
      agentId: input.agentId,
      agentRevision: input.agentRevision ?? null,
      sessionId: input.sessionId ?? null,
      trigger: input.trigger,
      contexts: input.contexts ?? null,
    });
  } catch (cause) {
    throw new RuntimeError('INVALID_INPUT', 'Start run request must be JSON-compatible', false, undefined, { cause });
  }
}
