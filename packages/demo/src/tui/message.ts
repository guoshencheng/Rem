import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { markdownTheme, userMessageStyle, assistantMessageStyle, thinkingMessageStyle } from "../theme.js";
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

type UIPart = {
  type: "text" | "reasoning";
  text: string;
  component: Markdown;
};

export class StreamAssistantMessage extends Container {
  private parts: Map<number, UIPart> = new Map();

  constructor() {
    super();
    this.addChild(new Spacer(1));
  }

  appendChunk(chunk: AgentStreamChunk): void {
    if (chunk.type === "text-delta") {
      this.appendDelta(chunk.partIndex, "text", chunk.text);
    } else if (chunk.type === "reasoning-delta") {
      this.appendDelta(chunk.partIndex, "reasoning", chunk.text);
    }
  }

  private appendDelta(
    partIndex: number,
    type: "text" | "reasoning",
    text: string,
  ): void {
    const existing = this.parts.get(partIndex);
    if (existing) {
      existing.text += text;
      existing.component.setText(existing.text);
      return;
    }

    const style = type === "text" ? assistantMessageStyle : thinkingMessageStyle;
    const component = new Markdown(text, 0, 0, markdownTheme, style);
    this.parts.set(partIndex, { type, text, component });
    this.addChild(component);
  }

  setText(text: string): void {
    this.parts = new Map();
    this.clear();
    this.addChild(new Spacer(1));
    const component = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.parts.set(0, { type: "text", text, component });
    this.addChild(component);
  }
}
