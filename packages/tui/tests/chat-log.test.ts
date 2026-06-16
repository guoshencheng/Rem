import { describe, it, expect } from "vitest";
import type { AgentStreamChunk } from "@agent-harness/core";
import { ChatLog } from "../src/chat-log.js";

describe("ChatLog", () => {
  it("prunes old messages when exceeding maxMessages", () => {
    const chatLog = new ChatLog(3);
    chatLog.addUser("msg 1");
    chatLog.addUser("msg 2");
    chatLog.addUser("msg 3");
    chatLog.addUser("msg 4");

    expect(chatLog.children.length).toBe(3);
  });

  it("toggles thinking collapsed state for all stream messages", () => {
    const chatLog = new ChatLog();
    const message = chatLog.startAssistant();
    message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking content" } as AgentStreamChunk);

    chatLog.toggleThinkingCollapsed(); // true -> false, expand
    const expandedLines = message.render(80);
    expect(expandedLines.some((line) => line.includes("thinking content"))).toBe(true);

    chatLog.toggleThinkingCollapsed(); // false -> true, collapse
    const collapsedLines = message.render(80);
    expect(collapsedLines.filter((line) => line.includes("thinking content")).length).toBe(0);
  });

  it("new stream messages inherit current thinking collapsed state", () => {
    const chatLog = new ChatLog();
    chatLog.toggleThinkingCollapsed(); // expand first

    const message = chatLog.startAssistant();
    message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
    message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking content" } as AgentStreamChunk);

    const lines = message.render(80);
    expect(lines.some((line) => line.includes("thinking content"))).toBe(true);
  });
});
