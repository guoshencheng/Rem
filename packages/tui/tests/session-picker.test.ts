import { describe, it, expect, vi } from "vitest";
import { SessionPicker } from "../src/session-picker.js";
import type { SessionPickerItem } from "../src/session-picker.js";

describe("SessionPicker", () => {
  function createItems(): SessionPickerItem[] {
    return [
      { sessionId: "abc-123", title: "Debug Task", updatedAt: new Date("2026-06-10T10:00:00Z"), messageCount: 5 },
      { sessionId: "def-456", title: undefined, updatedAt: new Date("2026-06-09T10:00:00Z"), messageCount: 2 },
    ];
  }

  it("renders session items", () => {
    const items = createItems();
    const picker = new SessionPicker(items, {
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const lines = picker.render(80);
    expect(lines.some((l) => l.includes("Debug Task"))).toBe(true);
  });

  it("calls onSelect when an item is selected", () => {
    const items = createItems();
    const onSelect = vi.fn();
    const picker = new SessionPicker(items, {
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput("\r"); // enter key

    expect(onSelect).toHaveBeenCalledWith("abc-123");
  });

  it("calls onCancel when escape is pressed", () => {
    const items = createItems();
    const onCancel = vi.fn();
    const picker = new SessionPicker(items, {
      onSelect: vi.fn(),
      onCancel,
    });

    picker.handleInput("\x1b"); // escape key

    expect(onCancel).toHaveBeenCalled();
  });

  it("uses session id prefix as label when no title", () => {
    const items: SessionPickerItem[] = [
      { sessionId: "abcdef123456", title: undefined, updatedAt: new Date(), messageCount: 1 },
    ];
    const picker = new SessionPicker(items, {
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const lines = picker.render(80);
    expect(lines.some((l) => l.includes("abcdef12"))).toBe(true);
  });
});
