import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { dim } from "../colors.js";
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
  type: "text" | "reasoning" | "tool-call" | "tool-result";
  partId: string;
  text: string;
  component: Markdown;
  wrapper?: Container;
  label?: Text;
  startTime?: number;
};

export class StreamAssistantMessage extends Container {
  private parts: Map<string, UIPart> = new Map();

  constructor() {
    super();
    this.addChild(new Spacer(1));
  }

  appendChunk(chunk: AgentStreamChunk): void {
    if (chunk.type === "text-start") {
      this.ensurePart(chunk.partId, "text");
    } else if (chunk.type === "text-delta") {
      this.appendDelta(chunk.partId, "text", chunk.text);
    } else if (chunk.type === "reasoning-start") {
      this.ensurePart(chunk.partId, "reasoning");
    } else if (chunk.type === "reasoning-delta") {
      this.appendDelta(chunk.partId, "reasoning", chunk.text);
    } else if (chunk.type === "reasoning-finish") {
      this.finishReasoning(chunk.partId);
    } else if (chunk.type === "tool-call") {
      this.updateToolCall(chunk.partId, chunk.toolName, chunk.input);
    } else if (chunk.type === "tool-result") {
      this.updateToolResult(chunk.partId, chunk.output, chunk.error);
    }
  }

  private ensurePart(partId: string, type: "text" | "reasoning"): void {
    if (this.parts.has(partId)) return;
    const style = type === "text" ? assistantMessageStyle : thinkingMessageStyle;
    const component = new Markdown("", 0, 0, markdownTheme, style);

    if (type === "reasoning") {
      const wrapper = new Container();
      const label = new Text("thinking", 0, 0, dim);
      wrapper.addChild(label);
      wrapper.addChild(component);
      this.parts.set(partId, { type, partId, text: "", component, wrapper, label, startTime: Date.now() });
      this.addChild(wrapper);
    } else {
      this.parts.set(partId, { type, partId, text: "", component });
      this.addChild(component);
    }
  }

  private appendDelta(partId: string, type: "text" | "reasoning", text: string): void {
    const existing = this.parts.get(partId);
    if (!existing) {
      this.ensurePart(partId, type);
    }
    const part = this.parts.get(partId)!;
    part.text += text;
    part.component.setText(part.text);
  }

  private finishReasoning(partId: string): void {
    const part = this.parts.get(partId);
    if (!part || part.type !== "reasoning" || !part.label || !part.startTime) return;
    const durationMs = Date.now() - part.startTime;
    const durationS = (durationMs / 1000).toFixed(1);
    part.label.setText(`think for ${durationS}s`);
  }

  private updateToolCall(partId: string, toolName: string, input: unknown): void {
    const existing = this.parts.get(partId);
    const text = `${toolName}(${JSON.stringify(input)})`;
    if (existing) {
      existing.text = text;
      existing.component.setText(existing.text);
      return;
    }
    const component = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.parts.set(partId, { type: "tool-call", partId, text, component });
    this.addChild(component);
  }

  private updateToolResult(partId: string, output: string, error?: string): void {
    const existing = this.parts.get(partId);
    const text = error ? `error: ${error}` : `result: ${output}`;
    if (existing) {
      existing.text = text;
      existing.component.setText(text);
      return;
    }
    const component = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.parts.set(partId, { type: "tool-result", partId, text, component });
    this.addChild(component);
  }

  setText(text: string): void {
    this.parts = new Map();
    this.clear();
    this.addChild(new Spacer(1));
    const component = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.parts.set("static", { type: "text", partId: "static", text, component });
    this.addChild(component);
  }
}
