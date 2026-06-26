import type { JSX } from "solid-js";
import { TextAttributes } from "@opentui/core";
import type { SessionState } from "./store.js";

export function StatusBar(props: { session: SessionState }): JSX.Element {
  return (
    <text attributes={TextAttributes.DIM}>
      Core Demo  |  turn: {props.session.currentTurn}/{props.session.maxTurns}  |  status: {props.session.status}  |  {props.session.sessionId.slice(0, 8)}
    </text>
  );
}
