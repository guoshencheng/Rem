import type { Message, AssistantMessage, TextContent, ThinkingContent, ToolCall, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { RemMessage } from '../../../types.js';
import type { LoopContext, LoopResult, LoopStrategy } from '../../../sdk/loop-strategy.js';
import { emptyUsage, addUsage } from '../../../token-usage.js';

const DEFAULT_MAX_STEPS = 50;

export class ReactLoop implements LoopStrategy {
  async run(ctx: LoopContext): Promise<LoopResult> {
    let content = '';
    let usage = emptyUsage();

    const assistantMsg = this.ensureAssistantMessage(ctx);
    ctx.emit({ type: 'message-start', step: 1, messageId: assistantMsg.messageId });

    let step = 1;
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;
    let lastMessage: AssistantMessage | undefined;
    let contentOffset = 0;

    while (step <= maxSteps) {
      if (ctx.signal?.aborted) throw new Error('Aborted');

      ctx.emit({ type: 'step-start', step });

      const stream = ctx.stream();
      const toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
      for await (const event of stream) {
        if ('contentIndex' in event && typeof event.contentIndex === 'number') {
          ctx.emit({ ...event, contentIndex: event.contentIndex + contentOffset } as AssistantMessageEvent);
        } else {
          ctx.emit(event);
        }
        if (event.type === 'text_delta') content += event.delta;
        if (event.type === 'toolcall_end') {
          toolCalls.push({
            toolCallId: event.toolCall.id,
            toolName: event.toolCall.name,
            input: event.toolCall.arguments,
          });
        }
      }
      const message = await stream.result();
      lastMessage = message;
      usage = addUsage(usage, message.usage ?? emptyUsage());
      contentOffset += message.content.length;
      this.appendToAssistantMessage(ctx, assistantMsg, message);

      if (toolCalls.length === 0) {
        ctx.emit({ type: 'step-finish', step });
        break;
      }

      await ctx.execute(toolCalls);
      ctx.emit({ type: 'step-finish', step });
      step++;
    }

    return { content, usage, message: lastMessage };
  }

  private ensureAssistantMessage(ctx: LoopContext): RemMessage {
    const last = ctx.messages[ctx.messages.length - 1];
    if (last?.role === 'assistant') {
      const messageId = ctx.resolveMessageId?.(last) ?? 'unknown';
      return { messageId, message: last };
    }
    return ctx.addMessage('assistant');
  }

  private appendToAssistantMessage(
    ctx: LoopContext,
    assistantMsg: RemMessage,
    message: { content: Array<TextContent | ThinkingContent | ToolCall> },
  ): void {
    for (const block of message.content) {
      ctx.appendContent(assistantMsg.message, block);
    }
  }
}
