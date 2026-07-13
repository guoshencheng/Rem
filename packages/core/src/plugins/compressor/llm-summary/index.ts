import type { ContextCompressor } from '../../../sdk/compressor.js';
import type { ModelMessage } from '../../../types.js';
import type { Session } from '../../../session.js';
import type { ResolvedModelConfig, CompressionConfig } from '../../../sdk/config-provider.js';
import type { TokenUsageDetail } from '../../../token-usage.js';
import { resolveContextWindow } from '../../../llm/context-window.js';
import { reason } from '../../../reason/reason.js';
import { splitHeadTail } from './split.js';
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from './prompt.js';
import { generateId } from '../../../shared/generate-id.js';

export class LLMSummarizingCompressor implements ContextCompressor {
  constructor(
    private config: Required<CompressionConfig>,
    private modelConfig: ResolvedModelConfig,
  ) {}

  shouldCompress(session: Session): boolean {
    if (!this.config.enabled) return false;

    const history = (session.metadata.tokenUsageHistory ?? []) as TokenUsageDetail[];
    const accumulated = history.reduce((sum, entry) => sum + entry.totalTokens, 0);
    const offset = (session.metadata.compressionTokenOffset as number) ?? 0;
    const effectiveTokens = accumulated - offset;

    if (effectiveTokens <= 0 && history.length === 0) {
      const totalChars = session.conversation.reduce((sum, msg) => {
        const text = msg.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('');
        return sum + text.length;
      }, 0);
      const estimated = Math.ceil(totalChars / 4);
      const maxTokens = resolveContextWindow(this.modelConfig.provider, this.modelConfig.model);
      return estimated >= maxTokens * this.config.thresholdRatio;
    }

    const maxTokens = resolveContextWindow(this.modelConfig.provider, this.modelConfig.model);
    const threshold = maxTokens * this.config.thresholdRatio;
    return effectiveTokens >= threshold;
  }

  async compress(messages: ModelMessage[]): Promise<ModelMessage[]> {
    const { head, middle, tail } = splitHeadTail(
      messages,
      this.config.protectHead,
      this.config.protectTail,
    );

    if (middle.length === 0) {
      return messages;
    }

    const prompt = buildSummaryPrompt(middle);
    const result = await reason(
      {
        provider: this.modelConfig.provider,
        model: this.modelConfig.model,
        apiKey: this.modelConfig.apiKey,
        baseURL: this.modelConfig.baseURL,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ id: generateId(), role: 'user', content: [{ type: 'text', text: prompt }] }],
        tools: {},
        signal: undefined,
        errorHandler: undefined,
      },
      () => {},
    );

    const summaryMsg: ModelMessage = {
      id: generateId(),
      role: 'system',
      content: [{ type: 'text', text: `[上下文压缩摘要]\n\n${result.text}` }],
    };

    return [...head, summaryMsg, ...tail];
  }
}
