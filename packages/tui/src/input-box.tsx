import type { JSX } from "solid-js";

interface InputBoxProps {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

export function InputBox(props: InputBoxProps): JSX.Element {
  return (
    <box marginTop={1}>
      <input
        placeholder={props.disabled ? "Agent is running..." : "Type a message..."}
        onSubmit={(value) => {
          if (typeof value === 'string') props.onSubmit(value);
        }}
        width="100%"
      />
    </box>
  );
}
