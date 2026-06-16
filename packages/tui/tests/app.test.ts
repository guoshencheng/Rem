import { describe, it, expect, vi } from "vitest";
import type { UIAgentSession } from "@agent-harness/core";
import { TUIApp } from "../src/app.js";

function createMockSession(): UIAgentSession {
  return {
    setCallbacks: vi.fn(),
    status: "idle",
    currentTurn: 0,
    maxTurns: 10,
    submit: vi.fn(),
    interrupt: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
  } as unknown as UIAgentSession;
}

describe("TUIApp", () => {
  it("ctrl+o toggles thinking collapsed state and requests render", () => {
    const app = new TUIApp({ session: createMockSession() });
    const chatLog = (app as any).chatLog;
    const tui = (app as any).tui;

    const toggleSpy = vi.spyOn(chatLog, "toggleThinkingCollapsed");
    const renderSpy = vi.spyOn(tui, "requestRender");

    const result = (app as any).handleGlobalInput("\x0f"); // ctrl+o raw byte

    expect(toggleSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledWith(true);
    expect(result).toEqual({ consume: true });
  });
});
