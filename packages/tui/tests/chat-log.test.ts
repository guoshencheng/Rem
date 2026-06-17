import { describe, it, expect } from "vitest";
import type { AgentStreamChunk, ModelMessage } from "@agent-harness/core";
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

  it("loadMessages renders user and assistant messages", () => {
    const chatLog = new ChatLog();
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" } as ModelMessage,
      { role: "assistant", content: "Hi there!" } as ModelMessage,
      { role: "user", content: "How are you?" } as ModelMessage,
    ];

    chatLog.loadMessages(messages);

    expect(chatLog.children.length).toBeGreaterThanOrEqual(3);
    const lines = chatLog.render(80);
    expect(lines.some((l) => l.includes("Hello"))).toBe(true);
    expect(lines.some((l) => l.includes("Hi there!"))).toBe(true);
    expect(lines.some((l) => l.includes("How are you?"))).toBe(true);
  });

  it("clearMessages removes all children", () => {
    const chatLog = new ChatLog();
    chatLog.addUser("msg 1");
    chatLog.addUser("msg 2");
    expect(chatLog.children.length).toBeGreaterThan(0);

    chatLog.clearMessages();
    expect(chatLog.children.length).toBe(0);
  });

  it("loadMessages skips empty content messages", () => {
    const chatLog = new ChatLog();
    const messages: ModelMessage[] = [
      { role: "user", content: "" } as ModelMessage,
      { role: "assistant", content: "Valid response" } as ModelMessage,
    ];

    chatLog.loadMessages(messages);

    expect(chatLog.children.length).toBeGreaterThan(0);
    const lines = chatLog.render(80);
    expect(lines.some((l) => l.includes("Valid response"))).toBe(true);
  });

  it("loadMessages renders reasoning content from assistant message parts", () => {
    const chatLog = new ChatLog();
    chatLog.toggleThinkingCollapsed(); // expand
    const messages: ModelMessage[] = [
      { role: "user", content: "Question" } as ModelMessage,
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          { type: "text", text: "The answer is 42." },
        ],
      } as ModelMessage,
    ];

    chatLog.loadMessages(messages);

    const lines = chatLog.render(80);
    expect(lines.some((l) => l.includes("Let me think about this"))).toBe(true);
    expect(lines.some((l) => l.includes("The answer is 42"))).toBe(true);
  });
});
