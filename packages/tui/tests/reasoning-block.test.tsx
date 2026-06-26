import { describe, it, expect } from "vitest";

function previewText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 50 ? `${clean.slice(0, 50)}…` : clean;
}

function reasoningLabel(p: { content: string; duration?: number }, collapsed: boolean): string {
  const base = p.duration != null
    ? `think for ${(p.duration / 1000).toFixed(1)}s`
    : "thinking";
  if (collapsed) {
    const prev = previewText(p.content);
    return `${base}${prev ? `: ${prev}` : ""} > (ctrl+o)`;
  }
  return base;
}

describe("ReasoningBlock", () => {
  it("shows thinking when not finished", () => {
    const label = reasoningLabel({ content: "" }, true);
    expect(label).toContain("thinking");
    expect(label).toContain("ctrl+o");
  });

  it("shows duration after finish", () => {
    const label = reasoningLabel({ content: "done", duration: 3000 }, true);
    expect(label).toContain("think for 3.0s");
  });

  it("shows preview text in collapsed mode", () => {
    const label = reasoningLabel({ content: "short text" }, true);
    expect(label).toContain("short text");
  });

  it("no ctrl+o hint when expanded", () => {
    const label = reasoningLabel({ content: "" }, false);
    expect(label).not.toContain("ctrl+o");
  });

  it("truncates long preview text", () => {
    const p = previewText("a".repeat(100));
    expect(p.endsWith("…")).toBe(true);
    expect(p.length).toBeLessThan(60);
  });
});
