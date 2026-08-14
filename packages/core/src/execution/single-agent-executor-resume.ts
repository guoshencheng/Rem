import type { Message } from '@earendil-works/pi-ai';
import type { ToolContext, ToolProvider } from '../sdk/tool-provider.js';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { NodeCheckpoint } from './run-execution-checkpoint.js';
import { resumePendingToolCalls } from './agent-loop/resume-tool-calls.js';

export async function resumeCheckpointTools(
  checkpoint: NodeCheckpoint,
  messages: Message[],
  provider: ToolProvider,
  context: ToolContext,
  signal: AbortSignal,
  onEvent: (event: AgentEvent) => void | Promise<void>,
): Promise<void> {
  if (checkpoint.kind !== 'pending-tools') return;
  const resumed = await resumePendingToolCalls({
    assistant: checkpoint.assistant, calls: checkpoint.calls, context, provider, signal, onEvent,
  });
  messages.push(...resumed);
}
