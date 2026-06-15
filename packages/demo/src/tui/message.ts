import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { markdownTheme, userMessageStyle, assistantMessageStyle } from "../theme.js";
import type { AgentStreamChunk } from "@agent-harness/core";

export class UserMessage extends Container {
  private body: Markdown;

  constructor(text: string) {
    super();
    this.body = new Markdown(text, 1, 0, markdownTheme, userMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}

export class AssistantMessage extends Container {
  private body: Markdown;

  constructor(text: string) {
    super();
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}

export class StreamAssistantMessage extends Container {
  private textParts: string[] = [];
  private reasoningParts: string[] = [];
  private body: Markdown;
  private reasoning: Markdown;

  constructor() {
    super();
    this.body = new Markdown("", 0, 0, markdownTheme, assistantMessageStyle);
    this.reasoning = new Markdown("", 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
    this.addChild(this.reasoning);
  }

  appendChunk(chunk: AgentStreamChunk): void {
    if (chunk.type === "text-delta") {
      this.textParts.push(chunk.text);
      this.body.setText(this.textParts.join(""));
    } else if (chunk.type === "reasoning-delta") {
      this.reasoningParts.push(chunk.text);
      this.reasoning.setText(this.reasoningParts.join(""));
    }
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}
