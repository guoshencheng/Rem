import type { ModelMessage } from '../types.js';

export interface TitleProvider {
  generateTitle(conversation: ModelMessage[]): Promise<string | undefined>;
}
