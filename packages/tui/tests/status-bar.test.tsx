import { describe, it, expect } from "vitest";
import type { SessionState } from "../src/store.js";

function statusBarText(session: SessionState): string {
  const id = session.sessionId.slice(0, 8);
  return `Core Demo  |  turn: ${session.currentTurn}/${session.maxTurns}  |  status: ${session.status}  |  ${id}`;
}

describe("StatusBar", () => {
  it("shows turn, maxTurns, status, and sessionId prefix", () => {
    const session: SessionState = {
      sessionId: "1234567890abcdef",
      currentTurn: 3,
      maxTurns: 60,
      status: "running",
    };
    const text = statusBarText(session);
    expect(text).toContain("turn: 3/60");
    expect(text).toContain("status: running");
    expect(text).toContain("12345678");
  });

  it("shows idle status initially", () => {
    const session: SessionState = {
      sessionId: "abc",
      currentTurn: 0,
      maxTurns: 60,
      status: "idle",
    };
    const text = statusBarText(session);
    expect(text).toContain("status: idle");
  });
});
