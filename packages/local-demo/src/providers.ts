import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { Provider } from 'rem-agent-ui/local';

// OpenAI SDK 默认带 x-stainless-* 头，MiniMax CORS allow-headers 不含它们，
// 用 null 清除（openai SDK buildHeaders 语义：null = 删除该 header）。
const STRIP_STAINLESS_HEADERS = {
  'X-Stainless-Lang': null,
  'X-Stainless-Package-Version': null,
  'X-Stainless-OS': null,
  'X-Stainless-Arch': null,
  'X-Stainless-Runtime': null,
  'X-Stainless-Runtime-Version': null,
  'X-Stainless-Retry-Count': null,
  'X-Stainless-Timeout': null,
} as unknown as Record<string, string>;

/**
 * MiniMax 的 OpenAI 兼容端点。浏览器直连时 Anthropic 兼容端点的
 * x-api-key / anthropic-version 头不在 CORS allow-headers 里会被拦截，
 * OpenAI 端点只需 Authorization: Bearer，可以直连。
 */
export function createMiniMaxOpenAIProvider(): Provider {
  const baseUrl = 'https://api.minimaxi.com/v1';
  return createProvider({
    id: 'minimax-openai',
    name: 'MiniMax (OpenAI-compatible)',
    baseUrl,
    // apiKey 由 runAgent 通过 stream options 传入（applyAuth 中 options 优先）
    auth: { apiKey: { name: 'MiniMax API key', resolve: async () => undefined } },
    models: [
      {
        id: 'MiniMax-M3',
        name: 'MiniMax-M3',
        api: 'openai-completions',
        provider: 'minimax-openai',
        baseUrl,
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
        headers: STRIP_STAINLESS_HEADERS,
      },
    ],
    api: openAICompletionsApi(),
  });
}
