import { For, Switch, Match } from "solid-js";
import type { MessagePart } from "../store.js";
import { AssistantMessage } from "./assistant-message.js";
import { ReasoningBlock } from "./reasoning-block.js";
import { FunctionToolBlock } from "./function-tool-block.js";

export function StreamMessage(props: {
  parts: Record<string, MessagePart>;
  reasoningCollapsed: boolean;
  toolsCollapsed: boolean;
}) {
  const entries = () => Object.entries(props.parts);

  return (
    <box flexDirection="column">
      <For each={entries()}>
        {([_partId, part]) => (
          <Switch>
            <Match when={part.type === "text"}>
              <AssistantMessage content={(part as { type: "text"; content: string }).content} />
            </Match>
            <Match when={part.type === "reasoning"}>
              <ReasoningBlock
                part={part as { type: "reasoning"; content: string; startTime: number; duration?: number }}
                globalCollapsed={props.reasoningCollapsed}
              />
            </Match>
            <Match when={part.type === "tool"}>
              <FunctionToolBlock
                part={part as { type: "tool"; toolName: string; input?: unknown; status: "pending" | "running" | "success" | "error"; output?: string; error?: string; startTime: number; endTime?: number }}
                globalCollapsed={props.toolsCollapsed}
              />
            </Match>
          </Switch>
        )}
      </For>
    </box>
  );
}
