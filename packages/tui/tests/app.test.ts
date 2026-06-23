import { describe, it, expect, vi } from "vitest";
import { TUIApp } from "../src/app.js";

describe("TUIApp", () => {
  it("ctrl+o toggles thinking collapsed state and requests render", () => {
    const app = new TUIApp({ serverUrl: "http://localhost:8321" });
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
