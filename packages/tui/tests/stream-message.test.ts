import { describe, it, expect } from "vitest";
import { StreamAssistantMessage } from "../src/message/stream-message.js";
import type { AgentStreamChunk } from "@agent-harness/core";

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

  it("creates reasoning block collapsed by default", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking content" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-finish", step: 1, partId: "r1" } as AgentStreamChunk);

    const lines = message.render(80);
    expect(lines.filter((line) => line.includes("thinking content")).length).toBe(0);
  });

  it("expands all reasoning blocks via setThinkingCollapsed(false)", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "first reasoning" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-finish", step: 1, partId: "r1" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-start", step: 1, partId: "r2" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r2", text: "second reasoning" } as AgentStreamChunk);

    message.setThinkingCollapsed(false);
    const lines = message.render(80);
    expect(lines.some((line) => line.includes("first reasoning"))).toBe(true);
    expect(lines.some((line) => line.includes("second reasoning"))).toBe(true);
  });
});
