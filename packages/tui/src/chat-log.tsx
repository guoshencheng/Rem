import { For, Switch, Match } from "solid-js";
import type { Message, MessagePart } from "./store.js";
import { UserMessage } from "./message/user-message.js";
import { AssistantMessage } from "./message/assistant-message.js";
import { StreamMessage } from "./message/stream-message.js";

export function ChatLog(props: {
  messages: Message[];
  reasoningCollapsed: boolean;
  toolsCollapsed: boolean;
}) {
  return (
    <scrollbox flexGrow={1} stickyStart="bottom">
      <box flexDirection="column" gap={1}>
        <For each={props.messages}>
          {(msg) => (
            <Switch>
              <Match when={msg.role === "user"}>
                <UserMessage content={(msg as { content: string }).content} />
              </Match>
              <Match when={msg.role === "assistant"}>
                <AssistantMessage content={(msg as { content: string }).content} />
              </Match>
              <Match when={(msg as { role: string }).role === "assistant-streaming"}>
                <StreamMessage
                  parts={(msg as { parts: Record<string, MessagePart> }).parts}
                  reasoningCollapsed={props.reasoningCollapsed}
                  toolsCollapsed={props.toolsCollapsed}
                />
              </Match>
            </Switch>
          )}
        </For>
      </box>
    </scrollbox>
  );
}
