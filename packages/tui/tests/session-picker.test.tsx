import { describe, it, expect } from "vitest";
import type { SessionSummary } from "rem-agent-sdk";

describe("SessionPicker options", () => {
  it("formats session with title", () => {
    const sessions: SessionSummary[] = [
      { sessionId: "12345678-90ab", title: "Debug session", updatedAt: "2026-06-01T00:00:00Z", messageCount: 5 },
    ];
    const options = sessions.map((s) => ({
      name: s.title ? `${s.title} (${s.sessionId.slice(0, 8)})` : s.sessionId.slice(0, 8),
      description: `${s.messageCount} messages`,
      value: s.sessionId,
    }));
    expect(options[0].name).toContain("Debug session");
    expect(options[0].name).toContain("12345678");
  });

  it("falls back to sessionId when no title", () => {
    const sessions: SessionSummary[] = [
      { sessionId: "abcdef12-3456", title: undefined, updatedAt: "2026-06-01T00:00:00Z", messageCount: 0 },
    ];
    const options = sessions.map((s) => ({
      name: s.title ? `${s.title} (${s.sessionId.slice(0, 8)})` : s.sessionId.slice(0, 8),
      description: `${s.messageCount} messages`,
      value: s.sessionId,
    }));
    expect(options[0].name).toBe("abcdef12");
  });
});
