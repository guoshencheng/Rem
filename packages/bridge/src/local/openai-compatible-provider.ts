import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { Model, Provider } from 'rem-agent-core/browser';

// OpenAI SDK 默认带 x-stainless-* 头，部分端点（如 MiniMax）的 CORS
// allow-headers 不含它们，用 null 清除（openai SDK buildHeaders 语义：null = 删除该 header）。
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

export interface OpenAICompatibleProviderOptions {
  id: string;
  name: string;
  baseUrl: string;
  models: Array<Pick<Model<'openai-completions'>, 'id' | 'name' | 'contextWindow' | 'maxTokens'> & { reasoning?: boolean }>;
}

/**
 * 创建浏览器可直连的 OpenAI 兼容 provider。
 * 只需 Authorization: Bearer 头（CORS 普遍放行）；apiKey 由 runAgent
 * 通过 stream options 传入（pi-ai applyAuth 中 options 优先）。
 */
export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): Provider {
  return createProvider({
    id: options.id,
    name: options.name,
    baseUrl: options.baseUrl,
    auth: { apiKey: { name: `${options.name} API key`, resolve: async () => undefined } },
    models: options.models.map((m) => ({
      id: m.id,
      name: m.name,
      api: 'openai-completions' as const,
      provider: options.id,
      baseUrl: options.baseUrl,
      reasoning: m.reasoning ?? false,
      input: ['text' as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      headers: STRIP_STAINLESS_HEADERS,
    })),
    api: openAICompletionsApi(),
  });
}
