import { createSignal, Show } from "solid-js";
import type { ReasoningPart } from "../store.js";

function previewText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 50 ? `${clean.slice(0, 50)}…` : clean;
}

export function ReasoningBlock(props: {
  part: ReasoningPart;
  globalCollapsed: boolean;
}) {
  const [localCollapsed, setLocalCollapsed] = createSignal(true);
  const collapsed = () => props.globalCollapsed || localCollapsed();
  const durationS = () => props.part.duration != null
    ? (props.part.duration / 1000).toFixed(1)
    : null;

  const label = () => {
    const base = durationS() ? `think for ${durationS()}s` : "thinking";
    if (collapsed()) {
      const prev = previewText(props.part.content);
      return `${base}${prev ? `: ${prev}` : ""} > (ctrl+o)`;
    }
    return base;
  };

  return (
    <box borderStyle="single" padding={1}>
      <box onClick={() => setLocalCollapsed((v) => !v)}>
        <text dim>{label()}</text>
      </box>
      <Show when={!collapsed()}>
        <markdown content={props.part.content} />
      </Show>
    </box>
  );
}
