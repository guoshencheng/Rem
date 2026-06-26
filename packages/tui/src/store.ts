import { createStore } from "solid-js/store";

// ---- 消息 Part 类型 ----
export type TextPart = { type: "text"; content: string };
export type ReasoningPart = {
  type: "reasoning";
  content: string;
  startTime: number;
  duration?: number;
};
export type ToolPart = {
  type: "tool";
  toolName: string;
  input?: unknown;
  status: "pending" | "running" | "success" | "error";
  output?: string;
  error?: string;
  startTime: number;
  endTime?: number;
};
export type MessagePart = TextPart | ReasoningPart | ToolPart;

// ---- 消息类型 ----
export type UserMsg = { role: "user"; content: string };
export type AssistantMsg = { role: "assistant"; content: string };
export type StreamMsg = { role: "assistant-streaming"; parts: Record<string, MessagePart> };
export type Message = UserMsg | AssistantMsg | StreamMsg;

// ---- 状态类型 ----
export interface SessionState {
  sessionId: string;
  currentTurn: number;
  maxTurns: number;
  status: "idle" | "running" | "error";
}

export interface UIState {
  reasoningCollapsed: boolean;
  toolsCollapsed: boolean;
  pickerVisible: boolean;
  pickerSessions: import("rem-agent-sdk").SessionSummary[];
}

export interface AppState {
  session: SessionState;
  messages: Message[];
  ui: UIState;
}

// ---- 工厂函数 ----
export function createInitialState(opts: {
  sessionId: string;
  maxTurns: number;
}): AppState {
  return {
    session: {
      sessionId: opts.sessionId,
      currentTurn: 0,
      maxTurns: opts.maxTurns,
      status: "idle",
    },
    messages: [],
    ui: {
      reasoningCollapsed: true,
      toolsCollapsed: true,
      pickerVisible: false,
      pickerSessions: [],
    },
  };
}

// ---- Store 创建 ----
export function createAppStore(initial: AppState) {
  const [state, setState] = createStore<AppState>(initial);

  function addUserMessage(text: string) {
    setState("messages", (m) => [...m, { role: "user" as const, content: text }]);
  }

  function addAssistantMessage(text: string) {
    setState("messages", (m) => [...m, { role: "assistant" as const, content: text }]);
  }

  function startStreamMessage(): number {
    const msg: StreamMsg = { role: "assistant-streaming", parts: {} };
    setState("messages", (m) => [...m, msg]);
    return state.messages.length;
  }

  function applyChunk(msgIndex: number, chunk: import("rem-agent-sdk").AgentStreamChunk) {
    switch (chunk.type) {
      case "text-start":
      case "text-delta": {
        const partId = chunk.partId;
        const existing = state.messages[msgIndex]?.parts?.[partId];
        if (existing && existing.type === "text" && chunk.type === "text-delta") {
          setState("messages", msgIndex, "parts", partId, "content",
            (c: string) => c + (chunk as { text: string }).text);
        } else {
          setState("messages", msgIndex, "parts", partId, {
            type: "text",
            content: chunk.type === "text-delta" ? (chunk as { text: string }).text : "",
          });
        }
        break;
      }
      case "reasoning-start":
        setState("messages", msgIndex, "parts", chunk.partId, {
          type: "reasoning",
          content: "",
          startTime: Date.now(),
        });
        break;
      case "reasoning-delta": {
        const re = state.messages[msgIndex]?.parts?.[chunk.partId];
        if (!re || re.type !== "reasoning") {
          setState("messages", msgIndex, "parts", chunk.partId, {
            type: "reasoning",
            content: chunk.text,
            startTime: Date.now(),
          });
        } else {
          setState("messages", msgIndex, "parts", chunk.partId, "content",
            (c: string) => c + chunk.text);
        }
        break;
      }
      case "reasoning-finish": {
        const re = state.messages[msgIndex]?.parts?.[chunk.partId];
        if (re && re.type === "reasoning") {
          setState("messages", msgIndex, "parts", chunk.partId, "duration",
            Date.now() - (re.startTime ?? Date.now()));
        }
        break;
      }
      case "tool-call-start":
        setState("messages", msgIndex, "parts", chunk.partId, {
          type: "tool",
          toolName: chunk.toolName,
          input: undefined,
          status: "pending",
          startTime: Date.now(),
        });
        break;
      case "tool-call":
        setState("messages", msgIndex, "parts", chunk.partId, {
          type: "tool",
          toolName: chunk.toolName,
          input: (chunk as { input: unknown }).input,
          status: "pending",
          startTime: Date.now(),
        });
        break;
      case "tool-result-start":
        setState("messages", msgIndex, "parts", chunk.partId, "status", "running");
        break;
      case "tool-result": {
        const tr = chunk as { output: string; error?: string };
        setState("messages", msgIndex, "parts", chunk.partId, {
          status: tr.error ? "error" : "success",
          output: tr.output,
          error: tr.error,
          endTime: Date.now(),
        });
        break;
      }
    }
  }

  function finishStreamMessage(msgIndex: number, content: string) {
    const msg = state.messages[msgIndex];
    if (!msg || msg.role !== "assistant-streaming") return;
    if (content && Object.keys(msg.parts).length === 0) {
      setState("messages", msgIndex, {
        role: "assistant",
        content,
      } as AssistantMsg);
    } else {
      setState("messages", msgIndex, "role", "assistant" as const);
    }
  }

  function errorStreamMessage(msgIndex: number, errorMessage: string) {
    const msg = state.messages[msgIndex];
    if (!msg || msg.role !== "assistant-streaming") return;
    if (Object.keys(msg.parts).length === 0) {
      setState("messages", msgIndex, {
        role: "assistant",
        content: `Error: ${errorMessage}`,
      } as AssistantMsg);
    } else {
      setState("messages", msgIndex, "role", "assistant" as const);
    }
  }

  function clearMessages() {
    setState("messages", []);
  }

  function toggleReasoningCollapsed() {
    setState("ui", "reasoningCollapsed", (v) => !v);
  }

  function toggleToolsCollapsed() {
    setState("ui", "toolsCollapsed", (v) => !v);
  }

  return {
    state,
    setState,
    addUserMessage,
    addAssistantMessage,
    startStreamMessage,
    applyChunk,
    finishStreamMessage,
    errorStreamMessage,
    clearMessages,
    toggleReasoningCollapsed,
    toggleToolsCollapsed,
  };
}
