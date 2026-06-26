import { createSignal, Show } from "solid-js";
import type { ToolPart } from "../store.js";
import { getToolFormatter } from "./tool-formatter.js";

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

function formatDuration(startTime: number, endTime?: number): string {
  if (!endTime) return "";
  const ms = endTime - startTime;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function FunctionToolBlock(props: {
  part: ToolPart;
  globalCollapsed: boolean;
}) {
  const [localCollapsed, setLocalCollapsed] = createSignal(true);
  const collapsed = () => props.globalCollapsed || localCollapsed();

  const formatter = () => getToolFormatter(props.part.toolName);

  const label = () => {
    const p = props.part;
    const icon = statusIcon(p.status);
    const call = formatter().formatCall(p.toolName, p.input);
    const dur = formatDuration(p.startTime, p.endTime);

    if (p.status === "pending" || p.status === "running") {
      const hint = collapsed() ? " (ctrl+o)" : "";
      return `${icon} ${call} ...${hint}`;
    }

    const summary = formatter().formatResultSummary(
      p.toolName, p.input, p.output ?? "", p.error,
    );

    if (collapsed()) {
      return `${icon} ${call}  ${summary}  (ctrl+o)`;
    }
    return `${icon} ${call}${dur ? ` (${dur})` : ""}`;
  };

  const body = () => formatter().formatResultBody(
    props.part.toolName, props.part.input, props.part.output ?? "", props.part.error,
  );

  return (
    <box borderStyle="single" padding={1}>
      <box>
        <text>{label()}</text>
      </box>
      <Show when={!collapsed() && (props.part.status === "success" || props.part.status === "error")}>
        <text>{body()}</text>
      </Show>
    </box>
  );
}
