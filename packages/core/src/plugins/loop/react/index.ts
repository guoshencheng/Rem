import type { ModelMessage } from '../../../types.js';
import type {
  LoopContext,
  LoopResult,
  LoopStrategy,
} from '../../../sdk/loop-strategy.js';
import type { LanguageModelUsage } from '../../../types.js';

const DEFAULT_MAX_STEPS = 50;

export class ReactLoop implements LoopStrategy {
  async run(ctx: LoopContext): Promise<LoopResult> {
    let content = '';
    let usage = this.zeroUsage();

    const assistantMsg = this.ensureAssistantMessage(ctx);
    ctx.emit({ type: 'message-start', step: 1, messageId: assistantMsg.id });

    let step = 1;
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;

    while (step <= maxSteps) {
      if (ctx.signal?.aborted) throw new Error('Aborted');

      ctx.emit({ type: 'step-start', step });

      const reasonResult = await ctx.reason();

      this.appendToAssistantMessage(ctx, assistantMsg, reasonResult);
      content = reasonResult.text;
      usage = this.addUsage(usage, reasonResult.usage);

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

  private ensureAssistantMessage(ctx: LoopContext): ModelMessage {
    const last = ctx.messages[ctx.messages.length - 1];
    if (last?.role === 'assistant') return last;
    return ctx.addMessage('assistant');
  }

  private appendToAssistantMessage(
    ctx: LoopContext, assistantMsg: ModelMessage,
    result: { text: string; toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>; reasoning?: string },
  ): void {
    if (result.reasoning) ctx.appendContent(assistantMsg, { type: 'reasoning', text: result.reasoning });
    if (result.text) ctx.appendContent(assistantMsg, { type: 'text', text: result.text });
    for (const tc of result.toolCalls) {
      ctx.appendContent(assistantMsg, { type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, arguments: tc.input });
    }
  }

  private zeroUsage(): LanguageModelUsage {
    return {
      inputTokens: 0, outputTokens: 0, totalTokens: 0,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };
  }

  private addUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
    return {
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      totalTokens: a.totalTokens + b.totalTokens,
      inputTokenDetails: a.inputTokenDetails,
      outputTokenDetails: b.outputTokenDetails,
    };
  }
}
