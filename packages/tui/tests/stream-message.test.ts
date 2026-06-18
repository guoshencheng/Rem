import { describe, it, expect } from "vitest";
import { StreamAssistantMessage } from "../src/message/stream-message.js";
import type { AgentStreamChunk } from "rem-agent-core";

describe("StreamAssistantMessage", () => {
  it("appends text deltas", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "text-start", step: 1, partId: "p1" } as AgentStreamChunk);
    message.appendChunk({ type: "text-delta", step: 1, partId: "p1", text: "hello" } as AgentStreamChunk);
    message.appendChunk({ type: "text-delta", step: 1, partId: "p1", text: " world" } as AgentStreamChunk);

    expect(message.children.length).toBeGreaterThan(0);
  });

  it("appends reasoning block", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-finish", step: 1, partId: "r1" } as AgentStreamChunk);

    expect(message.children.length).toBeGreaterThan(0);
  });

  it("creates reasoning block collapsed by default with text preview in label", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking content" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-finish", step: 1, partId: "r1" } as AgentStreamChunk);

    const lines = message.render(80);
    expect(lines.some((line) => line.includes("thinking content"))).toBe(true);
  });

  it("creates tool block collapsed by default with formatted label", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "tool-call-start", step: 1, partId: "tc1", toolCallId: "tc1", toolName: "read" } as AgentStreamChunk);
    message.appendChunk({ type: "tool-call", step: 1, partId: "tc1", toolCallId: "tc1", toolName: "read", input: { path: "foo.txt" } } as AgentStreamChunk);
    message.appendChunk({ type: "tool-result-start", step: 1, partId: "tc1", toolCallId: "tc1" } as AgentStreamChunk);
    message.appendChunk({ type: "tool-result", step: 1, partId: "tc1", toolCallId: "tc1", output: "hello\nworld\n", error: undefined } as AgentStreamChunk);
    message.appendChunk({ type: "tool-result-finish", step: 1, partId: "tc1", toolCallId: "tc1" } as AgentStreamChunk);

    const lines = message.render(80);
    expect(lines.some((line) => line.includes("Read(foo.txt)"))).toBe(true);
    expect(lines.some((line) => line.includes("hello"))).toBe(false);
  });

  it("expands all tool blocks via setToolsCollapsed(false)", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "tool-call-start", step: 1, partId: "tc1", toolCallId: "tc1", toolName: "read" } as AgentStreamChunk);
    message.appendChunk({ type: "tool-call", step: 1, partId: "tc1", toolCallId: "tc1", toolName: "read", input: { path: "foo.txt" } } as AgentStreamChunk);
    message.appendChunk({ type: "tool-result", step: 1, partId: "tc1", toolCallId: "tc1", output: "hello" } as AgentStreamChunk);

    message.setToolsCollapsed(false);
    const lines = message.render(80);
    expect(lines.some((line) => line.includes("hello"))).toBe(true);
  });
});
