import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import type { AgentEvent, AgentLoopConfig } from '@earendil-works/pi-agent-core';

const EMPTY_USAGE: Usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export async function emitLoopFailure(params: {
  error: unknown;
  aborted: boolean;
  model?: AgentLoopConfig['model'];
  emit: (event: AgentEvent) => void | Promise<void>;
}): Promise<void> {
  const { error, aborted, model, emit } = params;
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: model?.api ?? 'unknown',
    provider: model?.provider ?? 'unknown',
    model: model?.id ?? 'unknown',
    usage: EMPTY_USAGE,
    stopReason: aborted ? 'aborted' : 'error',
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  } satisfies AssistantMessage;
  await emit({ type: 'message_start', message });
  await emit({ type: 'message_end', message });
  await emit({ type: 'turn_end', message, toolResults: [] });
  await emit({ type: 'agent_end', messages: [message] });
}
