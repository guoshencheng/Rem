import { describe, it, expect } from "vitest";
import { ReasoningBlock } from "../src/message/reasoning-block.js";

describe("ReasoningBlock", () => {
  it("renders only label when collapsed by default", () => {
    const block = new ReasoningBlock();
    const lines = block.render(80);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("thinking");
    expect(lines[0]).toContain(">");
  });

  it("renders full content when expanded", () => {
    const block = new ReasoningBlock();
    block.appendText("first line\nsecond line");
    block.setCollapsed(false);
    const lines = block.render(80);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.some((line) => line.includes("first line"))).toBe(true);
    expect(lines.some((line) => line.includes("second line"))).toBe(true);
  });

  it("updates label after finish", () => {
    const block = new ReasoningBlock();
    block.finish();
    const lines = block.render(80);
    expect(lines[0]).toMatch(/think for [\d.]+s/);
    expect(lines[0]).toContain(">");
  });

  it("continues collecting text while collapsed", () => {
    const block = new ReasoningBlock();
    block.appendText("hidden content");
    expect(block.render(80).some((line) => line.includes("hidden content"))).toBe(false);

    block.setCollapsed(false);
    expect(block.render(80).some((line) => line.includes("hidden content"))).toBe(true);
  });
});
