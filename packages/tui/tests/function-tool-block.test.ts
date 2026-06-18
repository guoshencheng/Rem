import { describe, it, expect } from "vitest";
import { FunctionToolBlock } from "../src/message/function-tool-block.js";

describe("FunctionToolBlock", () => {
  it("renders collapsed with formatted call and summary", () => {
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    block.setResult("hello world\n");
    const lines = block.render(80);
    // Should show formatted call: Read(foo.txt)
    expect(lines.some((line) => line.includes("Read(foo.txt)"))).toBe(true);

    // Set back to pending for the next test
  });

  it("expands to show result body", () => {
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    block.setResult("hello world\n");
    block.setCollapsed(false);
    const lines = block.render(80);
    // Expanded view should show the output content
    expect(lines.some((line) => line.includes("hello world"))).toBe(true);
  });

  it("transitions from pending to running to success", () => {
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    expect(block.render(80).some((line) => line.includes("◐"))).toBe(true);

    block.setRunning();
    expect(block.render(80).some((line) => line.includes("..."))).toBe(true);

    block.setResult("done");
    expect(block.render(80).some((line) => line.includes("✓"))).toBe(true);
  });

  it("shows failed state with error in label", () => {
    const block = new FunctionToolBlock("read", { path: "foo.txt" });
    block.setResult("", "not found");
    const lines = block.render(80);
    expect(lines.some((line) => line.includes("✗"))).toBe(true);
    expect(lines.some((line) => line.includes("not found"))).toBe(true);
  });

  it("shows formatted call for different tools", () => {
    const writeBlock = new FunctionToolBlock("write", { path: "out.txt", content: "data" });
    writeBlock.setResult("Successfully wrote 4 bytes to out.txt");
    const lines = writeBlock.render(80);
    expect(lines.some((line) => line.includes("Write(out.txt)"))).toBe(true);
    expect(lines.some((line) => line.includes("Wrote 4 bytes"))).toBe(true);
  });

  it("shows collapsed indicator for unknown tools", () => {
    const block = new FunctionToolBlock("custom_tool", { key: "val" });
    block.setResult("custom output");
    const lines = block.render(80);
    expect(lines.some((line) => line.includes("custom_tool"))).toBe(true);
  });
});
