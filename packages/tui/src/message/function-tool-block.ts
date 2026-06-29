import type { CliRenderer } from "@opentui/core";
import { BoxRenderable, TextRenderable, TextAttributes } from "@opentui/core";
import { getToolFormatter } from "./tool-formatter.js";

export type ToolStatus = "pending" | "running" | "success" | "error";

export interface ToolPartState {
  type: "tool";
  toolName: string;
  input?: unknown;
  status: ToolStatus;
  output?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

function statusIcon(status: ToolStatus): string {
  switch (status) {
    case "pending":
    case "running":
      return "◐";
    case "success":
      return "✓";
    case "error":
      return "✗";
  }
}

function formatDuration(startTime: number, endTime?: number): string {
  if (!endTime) return "";
  const ms = endTime - startTime;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface ToolBlockHandle {
  container: BoxRenderable;
  setCollapsed(c: boolean): void;
}

export function createToolBlock(
  renderer: CliRenderer,
  part: ToolPartState,
  collapsed: boolean,
): ToolBlockHandle {
  const label = new TextRenderable(renderer, {
    content: "",
    attributes: TextAttributes.DIM,
  });
  const body = new TextRenderable(renderer, {
    content: "",
    visible: false,
  });

  function update() {
    const fmt = getToolFormatter(part.toolName);
    const icon = statusIcon(part.status);
    const call = fmt.formatCall(part.toolName, part.input);
    const dur = formatDuration(part.startTime, part.endTime);

    if (part.status === "pending" || part.status === "running") {
      const hint = collapsed ? " (ctrl+o)" : "";
      label.content = `${icon} ${call} ...${hint}`;
    } else {
      const summary = fmt.formatResultSummary(
        part.toolName, part.input, part.output ?? "", part.error,
      );
      if (collapsed) {
        label.content = `${icon} ${call}  ${summary}  (ctrl+o)`;
      } else {
        label.content = `${icon} ${call}${dur ? ` (${dur})` : ""}`;
      }
    }

    if (!collapsed && (part.status === "success" || part.status === "error")) {
      body.content = fmt.formatResultBody(
        part.toolName, part.input, part.output ?? "", part.error,
      );
      body.visible = true;
    } else {
      body.visible = false;
    }
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
