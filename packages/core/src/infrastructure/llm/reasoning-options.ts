import type { Api, Model } from '@earendil-works/pi-ai';

const MINIMAX_PROVIDERS = new Set(['minimax', 'minimax-cn']);

export interface ReasoningOptions {
  apiKey?: string;
  baseURL?: string;
  signal?: AbortSignal;
  maxRetries?: number;
  reasoning?: string;
}

/**
 * 把通用 reasoning 配置转换为 pi-ai 需要的选项。
 *
 - MiniMax 的 Anthropic-messages 兼容端点需要 `thinkingEnabled: true` 才会触发 adaptive
 *   thinking；`reasoning` 字符串本身对 `models.stream/complete` 无效。
 - 其他 provider 直接透传 `reasoning`，由各自的 `streamSimple` 或 API 层处理。
 */
export function buildReasoningOptions(model: Model<Api>, options: ReasoningOptions): Record<string, unknown> {
  if (MINIMAX_PROVIDERS.has(model.provider)) {
    const { reasoning, ...rest } = options;
    return { ...rest, thinkingEnabled: model.reasoning };
  }
  return options as Record<string, unknown>;
}
