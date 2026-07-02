import type { CliRenderer } from "@opentui/core";
import { BoxRenderable, TextRenderable, TextAttributes } from "@opentui/core";

export interface ReasoningPartState {
  type: "reasoning";
  content: string;
  startTime: number;
  duration?: number;
}

function previewText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 50 ? `${clean.slice(0, 50)}…` : clean;
}

export interface ReasoningBlockHandle {
  container: BoxRenderable;
  setCollapsed(c: boolean): void;
}

export function createReasoningBlock(
  renderer: CliRenderer,
  part: ReasoningPartState,
  collapsed: boolean,
): ReasoningBlockHandle {
  const label = new TextRenderable(renderer, {
    content: "",
    attributes: TextAttributes.DIM,
  });
  const body = new TextRenderable(renderer, {
    content: part.content,
    visible: !collapsed,
  });

  function update() {
    const base = part.duration != null
      ? "thought"
      : "thinking...";
    if (collapsed) {
      const prev = previewText(part.content);
      label.content = `${base}${prev ? `: ${prev}` : ""} > (ctrl+o)`;
    } else {
      label.content = base;
    }
    body.content = part.content;
    body.visible = !collapsed;
  }

  update();

  const container = new BoxRenderable(renderer, { flexDirection: "column" });
  container.add(label);
  container.add(body);

  return {
    container,
    setCollapsed(c: boolean) {
      collapsed = c;
      update();
    },
  };
}
