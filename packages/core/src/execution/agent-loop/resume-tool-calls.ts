import type { AssistantMessage, Message, ToolResultMessage } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { ToolCall, ToolContext, ToolProvider, ToolResult } from '../../sdk/tool-provider.js';
import { RuntimeError } from '../../application/runtime/runtime-error.js';

export async function resumePendingToolCalls(input: {
  assistant: AssistantMessage;
  calls: readonly ToolCall[];
  context: ToolContext;
  provider: ToolProvider;
  signal: AbortSignal;
  now?: () => number;
  onEvent: (event: AgentEvent) => void | Promise<void>;
}): Promise<Message[]> {
  const messages: Message[] = [];
  for (const call of input.calls) {
    if (input.signal.aborted) throw new RuntimeError('EXECUTION_CANCELLED', 'Run execution cancelled');
    const args = call.input;
    await input.onEvent({ type: 'tool_execution_start', toolCallId: call.toolCallId, toolName: call.toolName, args });
    let result: ToolResult | undefined;
    try {
      [result] = await input.provider.execute([{ toolCallId: call.toolCallId, toolName: call.toolName, input: args }], { ...input.context, signal: input.signal, toolCallId: call.toolCallId });
    } catch (error) {
      if (error instanceof RuntimeError && ['TOOL_RESULT_UNKNOWN', 'EXECUTION_CANCELLED', 'RUN_CONFLICT'].includes(error.code)) throw error;
      result = { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: 'Tool execution failed' };
    }
    if (!result || typeof result.output !== 'string') result = { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: 'Tool execution failed' };
    const isError = typeof result.error === 'string';
    const text = isError ? result.error ?? 'Tool execution failed' : result.output;
    const toolResult = { content: [{ type: 'text' as const, text }], details: result.details ?? {}, };
    await input.onEvent({ type: 'tool_execution_end', toolCallId: call.toolCallId, toolName: call.toolName, result: toolResult, isError });
    const message: ToolResultMessage = {
      role: 'toolResult', toolCallId: call.toolCallId, toolName: call.toolName, content: toolResult.content,
      details: toolResult.details, isError, timestamp: input.now?.() ?? Date.now(),
    };
    await input.onEvent({ type: 'message_start', message });
    await input.onEvent({ type: 'message_end', message });
    messages.push(message);
  }
  return messages;
}
