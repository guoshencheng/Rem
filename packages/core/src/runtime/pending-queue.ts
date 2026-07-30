import type { Message } from '@earendil-works/pi-ai';
import type { QueueMode } from '@earendil-works/pi-agent-core';

/** steering / follow-up 共用待定消息队列 */
export class PendingMessageQueue {
  private messages: Message[] = [];
  mode: QueueMode;

  constructor(mode: QueueMode) {
    this.mode = mode;
  }

  enqueue(message: Message): void {
    this.messages.push(message);
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  drain(): Message[] {
    if (this.mode === 'all') {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }
    const first = this.messages[0];
    if (!first) {
      return [];
    }
    this.messages = this.messages.slice(1);
    return [first];
  }

  clear(): void {
    this.messages = [];
  }
}
