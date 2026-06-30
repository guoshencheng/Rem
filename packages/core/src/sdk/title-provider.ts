import type { ModelMessage } from '../types.js';

export interface TitleProvider {
  generateTitle(
    conversation: ModelMessage[],
    config: {
      provider: string;
      providerConfig: { model: string; apiKey: string; baseURL?: string };
    },
  ): Promise<string | undefined>;
}
