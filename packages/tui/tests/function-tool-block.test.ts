import { describe, it, expect, vi } from "vitest";
import { FunctionToolBlock } from "../src/message/function-tool-block.js";

describe("FunctionToolBlock", () => {
  it("renders collapsed by default", () => {
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    const lines = block.render(80);
    expect(lines.some((line) => line.includes("read"))).toBe(true);
    expect(lines.some((line) => line.includes('"path"'))).toBe(false);
  });

  it("expands to show input and output", () => {
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    block.setResult("hello");
    block.setCollapsed(false);
    const lines = block.render(80);
    expect(lines.some((line) => line.includes("Input"))).toBe(true);
    expect(lines.some((line) => line.includes("foo.txt"))).toBe(true);
    expect(lines.some((line) => line.includes("Output"))).toBe(true);
    expect(lines.some((line) => line.includes("hello"))).toBe(true);
  });

  it("transitions from pending to running to success", () => {
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    expect(block.render(80).some((line) => line.includes("◐"))).toBe(true);

    block.setRunning();
    expect(block.render(80).some((line) => line.includes("..."))).toBe(true);

    block.setResult("done");
    expect(block.render(80).some((line) => line.includes("✓"))).toBe(true);
  });

  it("shows failed state with error", () => {
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    block.setResult("", "not found");
    block.setCollapsed(false);
    const lines = block.render(80);
    expect(lines.some((line) => line.includes("✗"))).toBe(true);
    expect(lines.some((line) => line.includes("Error"))).toBe(true);
    expect(lines.some((line) => line.includes("not found"))).toBe(true);
  });

  it("uses Date.now for duration", () => {
    const before = Date.now();
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    block.setResult("done");
    const lines = block.render(80);
    expect(lines.some((line) => /\dms/.test(line) || /\d\.\ds/.test(line))).toBe(true);
  });
});
