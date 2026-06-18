import { Container, Spacer } from "@earendil-works/pi-tui";
import type { AgentStreamChunk } from "rem-agent-core";
import { AssistantMessage } from "./assistant-message.js";
import { FunctionToolBlock } from "./function-tool-block.js";
import { ReasoningBlock } from "./reasoning-block.js";

type Part =
  | { type: "text"; partId: string; component: AssistantMessage }
  | { type: "reasoning"; partId: string; component: ReasoningBlock }
  | { type: "tool"; partId: string; component: FunctionToolBlock };

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
    } else if (chunk.type === "tool-call-start") {
      this.ensureToolPart(chunk.partId);
    } else if (chunk.type === "tool-call") {
      this.updateToolCall(chunk.partId, chunk.toolName, chunk.input);
    } else if (chunk.type === "tool-result-start") {
      this.setToolRunning(chunk.partId);
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

  loadContent(content: unknown): void {
    this.parts.clear();
    this.clear();
    this.addChild(new Spacer(1));

    if (typeof content === "string") {
      const component = new AssistantMessage(content);
      this.parts.set("static", { type: "text", partId: "static", component });
      this.addChild(component);
      return;
    }

    if (!Array.isArray(content)) return;

    let partIndex = 0;
    for (const part of content as Array<Record<string, unknown>>) {
      const type = part.type as string;
      if (type === "text") {
        const id = `text-${partIndex++}`;
        const component = new AssistantMessage(String(part.text ?? ""));
        this.parts.set(id, { type: "text", partId: id, component });
        this.addChild(component);
      } else if (type === "reasoning") {
        const id = `reasoning-${partIndex++}`;
        const component = new ReasoningBlock(this.thinkingCollapsed);
        component.loadText(String(part.text ?? ""));
        this.parts.set(id, { type: "reasoning", partId: id, component });
        this.addChild(component);
      } else if (type === "tool-call") {
        const id = part.toolCallId as string || `tool-${partIndex++}`;
        const component = new FunctionToolBlock(
          String(part.toolName ?? ""),
          part.input,
        );
        this.parts.set(id, { type: "tool", partId: id, component });
        this.addChild(component);
      }
    }
  }

  setThinkingCollapsed(collapsed: boolean): void {
    this.thinkingCollapsed = collapsed;
    for (const part of this.parts.values()) {
      if (part.type === "reasoning") {
        part.component.setCollapsed(collapsed);
      }
    }
  }

  setToolsCollapsed(collapsed: boolean): void {
    for (const part of this.parts.values()) {
      if (part.type === "tool") {
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

  private ensureToolPart(partId: string): void {
    if (this.parts.has(partId)) return;
    const component = new FunctionToolBlock("", undefined);
    this.parts.set(partId, { type: "tool", partId, component });
    this.addChild(component);
  }

  private updateToolCall(partId: string, toolName: string, input: unknown): void {
    const existing = this.parts.get(partId);
    if (existing && existing.type === "tool") {
      existing.component.update(toolName, input);
      return;
    }
    const component = new FunctionToolBlock(toolName, input);
    this.parts.set(partId, { type: "tool", partId, component });
    this.addChild(component);
  }

  private setToolRunning(partId: string): void {
    const existing = this.parts.get(partId);
    if (existing && existing.type === "tool") {
      existing.component.setRunning();
    }
  }

  private updateToolResult(partId: string, output: string, error?: string): void {
    const existing = this.parts.get(partId);
    if (existing && existing.type === "tool") {
      existing.component.setResult(output, error);
      return;
    }
    const component = new FunctionToolBlock("", undefined);
    component.setResult(output, error);
    this.parts.set(partId, { type: "tool", partId, component });
    this.addChild(component);
  }
}
