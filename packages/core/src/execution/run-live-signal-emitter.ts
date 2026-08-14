import type { RunSignal } from '../domain/event/types.js';
import type { RunSignalSource } from '../domain/event/types.js';
import type { RunLiveSignalDraft } from '../domain/event/live-signals.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';
import { isRunLiveSignalDraft } from '../domain/event/live-signals.js';
import { log } from '../infrastructure/observability/debug-log.js';
import { readWorkerNow, type ResolvedLocalRunWorkerOptions } from './local-worker-options.js';

export function createRunLiveSignalEmitter(
  runId: string,
  options: Pick<ResolvedLocalRunWorkerOptions, 'onSignal' | 'now'>,
): (draft: RunLiveSignalDraft) => void {
  return (draft) => {
    const publish = options.onSignal;
    if (!publish) return;
    try {
      if (!isRunLiveSignalDraft(draft)) return;
      const signal: RunSignal = {
        runId,
        type: draft.type,
        data: cloneCanonicalJson(draft.data, { omitUndefinedProperties: true }),
        ...(draft.source === undefined ? {} : { source: cloneSource(draft.source) }),
        occurredAt: readWorkerNow(options.now),
      };
      publish(signal);
    } catch (error) {
      // 实时投影是 best-effort；不得因为订阅者、序列化或时钟问题令执行失败。
      log('runtime-stream', 'live signal dropped', {
        runId, type: draft.type, error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function cloneSource(source: RunSignalSource): RunSignalSource {
  return { nodeId: source.nodeId, agentId: source.agentId, role: source.role };
}
