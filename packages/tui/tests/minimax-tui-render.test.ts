import { describe, it, expect } from "vitest";
import { StreamAssistantMessage } from "../src/message/stream-message.js";
import type { AgentStreamChunk } from "rem-agent-core";

describe("MiniMax TUI rendering trace", () => {
  it("renders reasoning delta into visible label", () => {
    const msg = new StreamAssistantMessage();

    // Simulate exact MiniMax stream: reasoning-start -> 3 deltas -> reasoning-finish -> text-start -> text-delta
    msg.appendChunk({ type: "reasoning-start", step: 1, partId: "reasoning-0" } as AgentStreamChunk);
    msg.appendChunk({ type: "reasoning-delta", step: 1, partId: "reasoning-0", text: "The user is asking me to look at documents" } as AgentStreamChunk);
    msg.appendChunk({ type: "reasoning-delta", step: 1, partId: "reasoning-0", text: " in a specific directory and choose one to summarize." } as AgentStreamChunk);
    msg.appendChunk({ type: "reasoning-delta", step: 1, partId: "reasoning-0", text: " However, I don't have access." } as AgentStreamChunk);
    msg.appendChunk({ type: "reasoning-finish", step: 1, partId: "reasoning-0" } as AgentStreamChunk);
    msg.appendChunk({ type: "text-start", step: 1, partId: "text-0" } as AgentStreamChunk);
    msg.appendChunk({ type: "text-delta", step: 1, partId: "text-0", text: "\n" } as AgentStreamChunk);

    const lines = msg.render(80);

    // Even collapsed, the label should contain a preview of the reasoning text
    const previewLine = lines.find(l => l.includes("The user is asking me to look"));
    expect(previewLine).toBeDefined();

    console.log("--- collapsed render ---");
    console.log(lines.join("\n"));
    console.log("--- end ---");

    // After expanding, should show full reasoning
    msg.setThinkingCollapsed(false);
    const expandedLines = msg.render(80);
    console.log("--- expanded render ---");
    console.log(expandedLines.join("\n"));
    console.log("--- end ---");

    const hasReasoningContent = expandedLines.some(l => l.includes("The user is asking me to look"));
    expect(hasReasoningContent).toBe(true);
  });

  it("renders tool-call lifecycle from MiniMax-style chunks", () => {
    const msg = new StreamAssistantMessage();

    msg.appendChunk({ type: "tool-call-start", step: 1, partId: "tc1", toolCallId: "tc1", toolName: "ls" } as AgentStreamChunk);
    msg.appendChunk({ type: "tool-call", step: 1, partId: "tc1", toolCallId: "tc1", toolName: "ls", input: { path: "." } } as AgentStreamChunk);
    msg.appendChunk({ type: "tool-result-start", step: 1, partId: "tc1", toolCallId: "tc1" } as AgentStreamChunk);
    msg.appendChunk({ type: "tool-result", step: 1, partId: "tc1", toolCallId: "tc1", output: "file1.txt\nfile2.txt\n" } as AgentStreamChunk);
    msg.appendChunk({ type: "tool-result-finish", step: 1, partId: "tc1", toolCallId: "tc1" } as AgentStreamChunk);

    const collapsed = msg.render(80);
    console.log("--- tool collapsed ---");
    console.log(collapsed.join("\n"));
    console.log("--- end ---");

    // Should show the tool name in collapsed label
    expect(collapsed.some(l => l.includes("ls"))).toBe(true);

    msg.setToolsCollapsed(false);
    const expanded = msg.render(80);
    console.log("--- tool expanded ---");
    console.log(expanded.join("\n"));
    console.log("--- end ---");

    expect(expanded.some(l => l.includes("file1.txt"))).toBe(true);
  });
});
