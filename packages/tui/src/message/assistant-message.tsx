import type { JSX } from "solid-js";

export function AssistantMessage(props: { content: string }): JSX.Element {
  return (
    <box padding={1}>
      <markdown content={props.content} />
    </box>
  );
}
