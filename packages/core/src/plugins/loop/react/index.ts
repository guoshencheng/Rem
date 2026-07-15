import type { Message } from '@earendil-works/pi-ai';
import type { RemMessage } from '../../../types.js';
import type {
  LoopContext,
  LoopResult,
  LoopStrategy,
} from '../../../sdk/loop-strategy.js';
import { emptyUsage, addUsage } from '../../../token-usage.js';

const DEFAULT_MAX_STEPS = 50;

export class ReactLoop implements LoopStrategy {
  async run(ctx: LoopContext): Promise<LoopResult> {
    let content = '';
    let usage = emptyUsage();

    const assistantMsg = await this.ensureAssistantMessage(ctx);
    ctx.emit({ type: 'message-start', step: 1, messageId: assistantMsg.messageId });

    let step = 1;
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;

    while (step <= maxSteps) {
      if (ctx.signal?.aborted) throw new Error('Aborted');

      ctx.emit({ type: 'step-start', step });

      const reasonResult = await ctx.reason();

      this.appendToAssistantMessage(ctx, assistantMsg, reasonResult);
      content = reasonResult.text;
      usage = addUsage(usage, reasonResult.usage);

      if (reasonResult.toolCalls.length === 0) {
        ctx.emit({ type: 'step-finish', step });
        break;
      }

      await ctx.execute(reasonResult.toolCalls);

      ctx.emit({ type: 'step-finish', step });
      step++;
    }

    return { content, usage };
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
    ctx: LoopContext, assistantMsg: RemMessage,
    result: { text: string; toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>; reasoning?: string },
  ): void {
    if (result.reasoning) ctx.appendContent(assistantMsg.message, { type: 'thinking', thinking: result.reasoning });
    if (result.text) ctx.appendContent(assistantMsg.message, { type: 'text', text: result.text });
    for (const tc of result.toolCalls) {
      ctx.appendContent(assistantMsg.message, { type: 'toolCall', id: tc.toolCallId, name: tc.toolName, arguments: tc.input as Record<string, any> });
    }
  }
}
