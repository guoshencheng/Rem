import { Container } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ModelMessage } from "@agent-harness/core";
import { UserMessage } from "./message/user-message.js";
import { AssistantMessage } from "./message/assistant-message.js";
import { StreamAssistantMessage } from "./message/stream-message.js";

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: Record<string, unknown>) => p.type === "text")
      .map((p: Record<string, unknown>) => String(p.text ?? ""))
      .join("\n");
  }
  return String(content);
}

export class ChatLog extends Container {
  private maxMessages: number;
  private thinkingCollapsed: boolean;

  constructor(maxMessages = 100) {
    super();
    this.maxMessages = maxMessages;
    this.thinkingCollapsed = true;
  }

  addUser(text: string): void {
    this.append(new UserMessage(text));
  }

  addAssistant(text: string): void {
    this.append(new AssistantMessage(text));
  }

  startAssistant(): StreamAssistantMessage {
    const message = new StreamAssistantMessage(this.thinkingCollapsed);
    this.append(message);
    return message;
  }

  loadMessages(messages: ModelMessage[]): void {
    this.clear();
    for (const msg of messages) {
      if (msg.role === "user") {
        const content = extractContent(msg.content);
        if (!content) continue;
        this.addUser(content);
      } else if (msg.role === "assistant") {
        const msgComponent = this.startAssistant();
        msgComponent.loadContent(msg.content);
      }
    }
  }

  clearMessages(): void {
    this.clear();
  }

  toggleThinkingCollapsed(): void {
    this.thinkingCollapsed = !this.thinkingCollapsed;
    for (const child of this.children) {
      if (child instanceof StreamAssistantMessage) {
        child.setThinkingCollapsed(this.thinkingCollapsed);
      }
    }
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
