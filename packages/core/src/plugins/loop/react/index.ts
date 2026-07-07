import type { ModelMessage } from '../../../types.js';
import type { AgentState } from '../../../state.js';
import type {
  LoopContext,
  LoopResult,
  LoopStrategy,
} from '../../../sdk/loop-strategy.js';
import type { ReasonProvider } from '../../../sdk/reason-provider.js';
import type { ExecuteProvider } from '../../../sdk/execute-provider.js';
import { generateId } from '../../../shared/generate-id.js';
import type { LanguageModelUsage } from '../../../types.js';
import type { ProviderChunk } from '../../../types.js';

export interface ReactLoopOptions {
  reasonProvider: ReasonProvider;
  executeProvider: ExecuteProvider;
}

const DEFAULT_MAX_STEPS = 50;

export class ReactLoop implements LoopStrategy {
  constructor(private options: ReactLoopOptions) {}

  async run(ctx: LoopContext): Promise<LoopResult> {
    const state = ctx.state;
    const newMessages: ModelMessage[] = [];
    let content = '';
    let usage = this.zeroUsage();

    const assistantMsg = this.createAssistantMessage(state);
    newMessages.push(assistantMsg);
    ctx.emit({ type: 'message-start', step: 1, messageId: assistantMsg.id });

    let step = 1;
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;

    while (step <= maxSteps) {
      if (ctx.signal?.aborted) {
        throw new Error('Aborted');
      }

      ctx.emit({ type: 'step-start', step });

      const reasonResult = await this.options.reasonProvider.reason(
        {
          provider: ctx.provider,
          model: ctx.modelConfig.model,
          apiKey: ctx.modelConfig.apiKey,
          baseURL: ctx.modelConfig.baseURL,
          system: ctx.system,
          messages: ctx.messages,
          tools: ctx.tools,
        },
        { signal: ctx.signal, sessionId: ctx.sessionId },
        (chunk) => this.emit(ctx, chunk, step),
      );

      this.appendToAssistantMessage(assistantMsg, reasonResult);
      content = reasonResult.text;
      usage = this.addUsage(usage, reasonResult.usage);

      if (reasonResult.toolCalls.length === 0) {
        ctx.emit({ type: 'step-finish', step });
        break;
      }

      await this.options.executeProvider.execute(
        reasonResult.toolCalls,
        {
          cwd: ctx.workspaceRoot,
          workspaceRoot: ctx.workspaceRoot,
          signal: ctx.signal,
          agentName: ctx.agentName,
          readOnly: ctx.readOnly,
          sessionId: ctx.sessionId ?? ctx.state.sessionId,
        },
        (chunk) => this.emit(ctx, chunk, step),
      );

      ctx.emit({ type: 'step-finish', step });

      ctx.messages = [...state.conversation];
      step++;
    }

    return { content, newMessages, usage };
  }

  private createAssistantMessage(state: AgentState): ModelMessage {
    const last = state.conversation[state.conversation.length - 1];
    if (last?.role === 'assistant') return last as ModelMessage;
    const msg: ModelMessage = { id: generateId(), role: 'assistant', content: [] };
    state.addMessage(msg);
    return msg;
  }

  private appendToAssistantMessage(
    assistantMsg: ModelMessage,
    result: { text: string; toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>; reasoning?: string },
  ): void {
    const content = assistantMsg.content;
    if (result.reasoning) {
      content.push({ type: 'reasoning', text: result.reasoning });
    }
    if (result.text) {
      content.push({ type: 'text', text: result.text });
    }
    for (const tc of result.toolCalls) {
      content.push({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, arguments: tc.input });
    }
  }

  private emit(ctx: LoopContext, chunk: ProviderChunk, step: number): void {
    if ('step' in chunk && typeof (chunk as { step?: number }).step === 'number') {
      (chunk as { step: number }).step = step;
    }
    void ctx.emit(chunk);
  }

  private zeroUsage(): LanguageModelUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
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

export function createProvider(options: ReactLoopOptions): ReactLoop {
  return new ReactLoop(options);
}
