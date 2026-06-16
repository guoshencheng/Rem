import { Container } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { UserMessage } from "./message/user-message.js";
import { AssistantMessage } from "./message/assistant-message.js";
import { StreamAssistantMessage } from "./message/stream-message.js";

export class ChatLog extends Container {
  private maxMessages: number;

  constructor(maxMessages = 100) {
    super();
    this.maxMessages = maxMessages;
  }

  addUser(text: string): void {
    this.append(new UserMessage(text));
  }

  addAssistant(text: string): void {
    this.append(new AssistantMessage(text));
  }

  startAssistant(): StreamAssistantMessage {
    const message = new StreamAssistantMessage();
    this.append(message);
    return message;
  }

  private append(component: Component): void {
    this.addChild(component);
    this.prune();
  }

  private prune(): void {
    while (this.children.length > this.maxMessages) {
      this.removeChild(this.children[0]);
    }
  }
}
