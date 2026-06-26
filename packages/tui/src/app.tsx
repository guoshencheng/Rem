import { Show } from "solid-js";
import { AgentClient, type AgentStreamChunk } from "rem-agent-sdk";
import {
  createAppStore,
  createInitialState,
} from "./store.js";
import { ChatLog } from "./chat-log.js";
import { StatusBar } from "./status-bar.js";
import { InputBox } from "./input-box.js";
import { SessionPicker } from "./session-picker.js";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface TUIAppOptions {
  serverUrl: string;
  sessionId?: string;
  maxTurns?: number;
}

export function TUIApp(props: TUIAppOptions) {
  const initial = createInitialState({
    sessionId: props.sessionId ?? generateId(),
    maxTurns: props.maxTurns ?? 60,
  });
  const store = createAppStore(initial);
  const client = new AgentClient(props.serverUrl);

  const isRunning = () => store.state.session.status === "running";

  async function handleSubmit(text: string) {
    if (isRunning()) return;
    if (store.state.session.currentTurn >= store.state.session.maxTurns) {
      store.addAssistantMessage("Maximum turns reached. Start a new session with /new.");
      return;
    }

    if (text === "/new") {
      client.interrupt(store.state.session.sessionId).catch(() => {});
      store.clearMessages();
      store.setState("session", {
        sessionId: generateId(),
        currentTurn: 0,
        status: "idle",
      });
      return;
    }
    if (text === "/resume") {
      const sessions = await client.listSessions();
      if (sessions.length === 0) {
        store.addAssistantMessage("No sessions found.");
        return;
      }
      store.setState("ui", "pickerSessions", sessions);
      store.setState("ui", "pickerVisible", true);
      return;
    }

    store.setState("session", "status", "running");
    store.setState("session", "currentTurn", (t: number) => t + 1);
    store.addUserMessage(text);

    const msgIndex = store.startStreamMessage();

    try {
      const stream = await client.run(store.state.session.sessionId, text);
      for await (const chunk of stream) {
        store.applyChunk(msgIndex, chunk as AgentStreamChunk);
        if (chunk.type === "finish") {
          store.finishStreamMessage(msgIndex, chunk.output.content);
          store.setState("session", "status", "idle");
        } else if (chunk.type === "error") {
          const errMsg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
          store.errorStreamMessage(msgIndex, errMsg);
          store.setState("session", "status", "error");
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      store.errorStreamMessage(msgIndex, errMsg);
      store.setState("session", "status", "error");
    }
  }

  async function handleSessionSelect(sessionId: string) {
    store.setState("ui", "pickerVisible", false);
    client.interrupt(store.state.session.sessionId).catch(() => {});
    store.clearMessages();
    store.setState("session", {
      sessionId,
      currentTurn: 0,
      status: "idle",
    });
  }

  function handleToggleCollapse() {
    store.toggleReasoningCollapsed();
    store.toggleToolsCollapsed();
  }

  return (
    <box flexDirection="column" height="100%">
      <ChatLog
        messages={store.state.messages}
        reasoningCollapsed={store.state.ui.reasoningCollapsed}
        toolsCollapsed={store.state.ui.toolsCollapsed}
      />
      <StatusBar session={store.state.session} />
      <InputBox disabled={isRunning()} onSubmit={handleSubmit} />
      <Show when={store.state.ui.pickerVisible}>
        <SessionPicker
          sessions={store.state.ui.pickerSessions}
          onSelect={handleSessionSelect}
          onCancel={() => store.setState("ui", "pickerVisible", false)}
        />
      </Show>
    </box>
  );
}
