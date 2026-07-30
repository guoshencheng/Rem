import type { Message } from '@earendil-works/pi-ai';

export interface TitleProvider {
  generateTitle(conversation: Message[]): Promise<string | undefined>;
}
