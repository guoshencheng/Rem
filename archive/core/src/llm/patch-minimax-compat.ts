import { hasApi } from '@earendil-works/pi-ai';
import type { AnthropicMessagesCompat, Api, Model } from '@earendil-works/pi-ai';

const MINIMAX_PROVIDERS = new Set(['minimax', 'minimax-cn']);

/**
 * 给 MiniMax 的 Anthropic-messages 兼容模型标记 `forceAdaptiveThinking`。
 * pi-ai 在 stream/complete 时读取该标志，向请求体注入 `thinking: { type: "adaptive" }`，
 * 从而开启 M3 的 thinking 内容块；M2.x 也兼容该参数。
 */
export function patchMiniMaxAdaptiveThinking(model: Model<Api>): void {
  if (!MINIMAX_PROVIDERS.has(model.provider)) return;
  if (!hasApi(model, 'anthropic-messages')) return;

  const m = model as Model<'anthropic-messages'>;
  m.compat = { ...(m.compat ?? {}), forceAdaptiveThinking: true } as AnthropicMessagesCompat;
}
