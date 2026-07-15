import type { Message, Models } from '@earendil-works/pi-ai';
import type { ContextCompressor } from '../../../sdk/compressor.js';
import type { Session } from '../../../session.js';
import type { ResolvedModelConfig, CompressionConfig } from '../../../sdk/config-provider.js';
import type { TokenUsageDetail } from '../../../token-usage.js';
import { resolveContextWindow } from '../../../llm/context-window.js';
import { generate } from '../../../reason/generate.js';
import { splitHeadTail } from './split.js';
import {
  buildSummaryPrompt,
  SUMMARY_SYSTEM_PROMPT,
  SUMMARY_TOOL_NAME,
  SUMMARY_TOOL_SCHEMA,
  formatSummaryAsMarkdown,
  type SummaryData,
} from './prompt.js';

export class LLMSummarizingCompressor implements ContextCompressor {
  constructor(
    private config: Required<CompressionConfig>,
    private modelConfig: ResolvedModelConfig,
    private models: Models,
  ) {}

  shouldCompress(session: Session): boolean {
    if (!this.config.enabled) return false;

    const history = (session.metadata.tokenUsageHistory ?? []) as TokenUsageDetail[];
    const accumulated = history.reduce((sum, entry) => sum + entry.totalTokens, 0);
    const offset = (session.metadata.compressionTokenOffset as number) ?? 0;
    const effectiveTokens = accumulated - offset;

    if (effectiveTokens <= 0 && history.length === 0) {
      const totalChars = session.conversation.reduce((sum, msg) => {
        const content = typeof msg.content === 'string' ? [msg.content] : msg.content;
        const text = content
          .filter((p): p is { type: 'text'; text: string } => typeof p === 'object' && p.type === 'text')
          .map((p) => p.text)
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

  async compress(messages: Message[]): Promise<Message[]> {
    const { head, middle, tail } = splitHeadTail(
      messages,
      this.config.protectHead,
      this.config.protectTail,
    );

    if (middle.length === 0) {
      return messages;
    }

    const prompt = buildSummaryPrompt(middle);
    const result = await generate({
      models: this.models,
      provider: this.modelConfig.provider,
      model: this.modelConfig.model,
      apiKey: this.modelConfig.apiKey,
      baseURL: this.modelConfig.baseURL,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }] as Message[],
      tools: {
        [SUMMARY_TOOL_NAME]: SUMMARY_TOOL_SCHEMA,
      },
    });

    const summaryCall = result.toolCalls.find((tc) => tc.toolName === SUMMARY_TOOL_NAME);
    const summaryData = summaryCall?.input as SummaryData | undefined;

    const summaryText = summaryData
      ? formatSummaryAsMarkdown(summaryData)
      : result.text;

    const summaryMsg: Message = {
      role: 'user',
      content: [{ type: 'text', text: `[上下文压缩摘要]\n\n${summaryText}` }],
      timestamp: Date.now(),
    } as unknown as Message;

    return [...head, summaryMsg, ...tail];
  }
}
