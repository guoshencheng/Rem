import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentRun } from '../domain/run/types.js';
import type { RuntimeObservationSink } from '../sdk/runtime-observer.js';
import type { ResolvedRuntimeModelConfig } from '../sdk/runtime-config-provider.js';
import type { RuntimeErrorCode } from '../domain/error/types.js';
import { sanitizeModelError } from './single-agent-executor-boundaries.js';

export function observeModel(
  sink: RuntimeObservationSink | undefined,
  phase: 'started' | 'completed' | 'failed',
  run: AgentRun,
  model: ResolvedRuntimeModelConfig,
  startedAt: number,
  message?: AssistantMessage,
  errorCode?: RuntimeErrorCode,
  diagnostic?: unknown,
): void {
  const usage = message?.usage;
  sink?.({
    type: `model.${phase}`, occurredAt: new Date(), tenantId: run.tenantId, sessionId: run.sessionId,
    runId: run.runId, nodeId: run.rootNodeId, agentId: run.agentId,
    provider: model.provider, model: model.model,
    ...(phase === 'started' ? {} : { durationMs: Math.max(0, Date.now() - startedAt) }),
    ...(usage?.input === undefined ? {} : { inputTokens: usage.input }),
    ...(usage?.output === undefined ? {} : { outputTokens: usage.output }),
    ...(usage?.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(diagnostic === undefined ? {} : { diagnostic: sanitizeModelError(diagnostic) }),
  });
}
