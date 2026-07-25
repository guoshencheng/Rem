import type { Provider } from 'rem-agent-core/browser';
import { createOpenAICompatibleProvider } from './openai-compatible-provider.js';

/**
 * 内置 provider 的浏览器兼容变体：内置 minimax/minimax-cn 走 Anthropic 协议，
 * 其 x-api-key / anthropic-version 头会被 MiniMax CORS 拦截（浏览器环境），
 * 这里提供走 OpenAI 兼容协议（仅需 Authorization: Bearer）的替代注册。
 * LocalAgentService 默认注册，无需用户配置。
 */
export function browserCompatibleProviders(): Provider[] {
  return [
    createOpenAICompatibleProvider({
      id: 'minimax-openai',
      name: 'MiniMax (OpenAI-compatible)',
      baseUrl: 'https://api.minimaxi.com/v1',
      models: [
        { id: 'MiniMax-M3', name: 'MiniMax-M3', contextWindow: 200000, maxTokens: 8192, reasoning: true },
      ],
    }),
  ];
}
