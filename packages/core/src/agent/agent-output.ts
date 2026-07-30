import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentOutput } from './types.js';

/** 从最终 Assistant 消息构造输出；stopReason=error 时构造 'Error: ...' 输出 */
export function buildAgentOutput(lastAssistant: AssistantMessage | undefined): AgentOutput {
  if (lastAssistant?.stopReason === 'error') {
    const errorMessage = lastAssistant.errorMessage ?? 'agent stream error';
    return { content: `Error: ${errorMessage}`, completed: true };
  }
  const content =
    lastAssistant?.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('') ?? '';
  return { content, completed: true };
}

/** 从异常构造 'Error: ...' 输出（run 捕获路径） */
export function buildAgentErrorOutput(error: unknown): AgentOutput {
  const message = error instanceof Error ? error.message : String(error);
  return { content: `Error: ${message}`, completed: true };
}

/** 从 'Error: ...' 输出取回错误消息（用于 error 事件，保持原事件结构） */
export function agentOutputErrorMessage(output: AgentOutput): string {
  return output.content.slice('Error: '.length);
}
