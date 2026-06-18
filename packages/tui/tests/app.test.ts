import { describe, it, expect, vi } from "vitest";
import type { CoreAgent } from "rem-agent-core";
import { TUIApp } from "../src/app.js";

function createMockAgent(): CoreAgent {
  return {
    on: vi.fn(() => vi.fn()),
    status: "idle",
    maxTurns: 10,
    sessionId: "test-session",
    conversation: [],
    initialize: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
    run: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    generateTitle: vi.fn().mockResolvedValue(""),
  } as unknown as CoreAgent;
}

describe("TUIApp", () => {
  it("ctrl+o toggles thinking collapsed state and requests render", () => {
    const app = new TUIApp({ agent: createMockAgent() });
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
