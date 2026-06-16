import { Container, Spacer } from "@earendil-works/pi-tui";
import type { AgentStreamChunk } from "@agent-harness/core";
import { AssistantMessage } from "./assistant-message.js";
import { ReasoningBlock } from "./reasoning-block.js";
import { ToolCallBlock } from "./tool-call-block.js";
import { ToolResultBlock } from "./tool-result-block.js";

type Part =
  | { type: "text"; partId: string; component: AssistantMessage }
  | { type: "reasoning"; partId: string; component: ReasoningBlock }
  | { type: "tool-call"; partId: string; component: ToolCallBlock }
  | { type: "tool-result"; partId: string; component: ToolResultBlock };

export class StreamAssistantMessage extends Container {
  private parts = new Map<string, Part>();
  private thinkingCollapsed: boolean;

  constructor(thinkingCollapsed = true) {
    super();
    this.thinkingCollapsed = thinkingCollapsed;
    this.addChild(new Spacer(1));
  }

  appendChunk(chunk: AgentStreamChunk): void {
    if (chunk.type === "text-start") {
      this.ensureTextPart(chunk.partId);
    } else if (chunk.type === "text-delta") {
      this.appendTextDelta(chunk.partId, chunk.text);
    } else if (chunk.type === "reasoning-start") {
      this.ensureReasoningPart(chunk.partId);
    } else if (chunk.type === "reasoning-delta") {
      this.appendReasoningDelta(chunk.partId, chunk.text);
    } else if (chunk.type === "reasoning-finish") {
      this.finishReasoning(chunk.partId);
    } else if (chunk.type === "tool-call") {
      this.updateToolCall(chunk.partId, chunk.toolName, chunk.input);
    } else if (chunk.type === "tool-result") {
      this.updateToolResult(chunk.partId, chunk.output, chunk.error);
    }
  }

  setText(text: string): void {
    this.parts.clear();
    this.clear();
    this.addChild(new Spacer(1));
    const component = new AssistantMessage(text);
    this.parts.set("static", { type: "text", partId: "static", component });
    this.addChild(component);
  }

  setThinkingCollapsed(collapsed: boolean): void {
    this.thinkingCollapsed = collapsed;
    for (const part of this.parts.values()) {
      if (part.type === "reasoning") {
        part.component.setCollapsed(collapsed);
      }
    }
  }

  private ensureTextPart(partId: string): void {
    if (this.parts.has(partId)) return;
    const component = new AssistantMessage("");
    this.parts.set(partId, { type: "text", partId, component });
    this.addChild(component);
  }

  private appendTextDelta(partId: string, text: string): void {
    this.ensureTextPart(partId);
    const part = this.parts.get(partId);
    if (!part || part.type !== "text") return;
    part.component.appendText(text);
  }

  private ensureReasoningPart(partId: string): void {
    if (this.parts.has(partId)) return;
    const component = new ReasoningBlock(this.thinkingCollapsed);
    this.parts.set(partId, { type: "reasoning", partId, component });
    this.addChild(component);
  }

  private appendReasoningDelta(partId: string, text: string): void {
    this.ensureReasoningPart(partId);
    const part = this.parts.get(partId);
    if (!part || part.type !== "reasoning") return;
    part.component.appendText(text);
  }

  private finishReasoning(partId: string): void {
    const part = this.parts.get(partId);
    if (!part || part.type !== "reasoning") return;
    part.component.finish();
  }

  private updateToolCall(partId: string, toolName: string, input: unknown): void {
    const existing = this.parts.get(partId);
    if (existing && existing.type === "tool-call") {
      existing.component.update(toolName, input);
      return;
    }
    const component = new ToolCallBlock(toolName, input);
    this.parts.set(partId, { type: "tool-call", partId, component });
    this.addChild(component);
  }

  private updateToolResult(partId: string, output: string, error?: string): void {
    const existing = this.parts.get(partId);
    if (existing && existing.type === "tool-result") {
      existing.component.update(output, error);
      return;
    }
    const component = new ToolResultBlock(output, error);
    this.parts.set(partId, { type: "tool-result", partId, component });
    this.addChild(component);
  }
}
