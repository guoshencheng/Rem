import type { JSX } from "solid-js";

export function UserMessage(props: { content: string }): JSX.Element {
  return (
    <box padding={1}>
      <text>{props.content}</text>
    </box>
  );
}
