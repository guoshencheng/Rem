import { describe, it, expect } from "vitest";
import { getToolFormatter } from "../src/message/tool-formatter.js";

function statusIcon(status: string): string {
  switch (status) {
    case "pending":
    case "running":
      return "\u25D0";
    case "success":
      return "\u2713";
    case "error":
      return "\u2717";
    default:
      return "?";
  }
}

describe("FunctionToolBlock", () => {
  it("formats read tool call", () => {
    const fmt = getToolFormatter("read");
    const call = fmt.formatCall("read", { path: "foo.txt" });
    expect(call).toContain("Read(foo.txt)");
  });

  it("shows pending icon", () => {
    expect(statusIcon("pending")).toBe("\u25D0");
  });

  it("shows success icon", () => {
    expect(statusIcon("success")).toBe("\u2713");
  });

  it("shows error icon", () => {
    expect(statusIcon("error")).toBe("\u2717");
  });

  it("formats write tool", () => {
    const fmt = getToolFormatter("write");
    const call = fmt.formatCall("write", { path: "out.txt" });
    expect(call).toContain("Write(out.txt)");
  });

  it("formats edit tool with edit count", () => {
    const fmt = getToolFormatter("edit");
    const call = fmt.formatCall("edit", { path: "src/a.ts", edits: [{}, {}] });
    expect(call).toContain("Edit(src/a.ts)");
    expect(call).toContain("2 edits");
  });

  it("formats ls tool", () => {
    const fmt = getToolFormatter("ls");
    const call = fmt.formatCall("ls", { path: "." });
    expect(call).toContain("ls(.)");
  });

  it("uses default formatter for unknown tools", () => {
    const fmt = getToolFormatter("unknown_tool");
    const call = fmt.formatCall("unknown_tool", { key: "val" });
    expect(call).toContain("unknown_tool");
  });
});
