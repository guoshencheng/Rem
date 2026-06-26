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
    const sm = state.messages[msgIndex];
    if (!sm || sm.role !== "assistant-streaming") return;

    const pid = (chunk as { partId?: string }).partId ?? "";

    switch (chunk.type) {
      case "text-start":
      case "text-delta": {
        const existing = sm.parts[pid];
        if (existing && existing.type === "text" && chunk.type === "text-delta") {
          existing.content += (chunk as { text: string }).text;
        } else {
          sm.parts[pid] = {
            type: "text",
            content: chunk.type === "text-delta" ? (chunk as { text: string }).text : "",
          };
        }
        break;
      }
      case "reasoning-start":
        sm.parts[pid] = {
          type: "reasoning",
          content: "",
          startTime: Date.now(),
        };
        break;
      case "reasoning-delta": {
        const re = sm.parts[pid];
        if (re && re.type === "reasoning") {
          re.content += chunk.text;
        } else {
          sm.parts[pid] = {
            type: "reasoning",
            content: chunk.text,
            startTime: Date.now(),
          };
        }
        break;
      }
      case "reasoning-finish": {
        const re = sm.parts[pid];
        if (re && re.type === "reasoning") {
          re.duration = Date.now() - (re.startTime ?? Date.now());
        }
        break;
      }
      case "tool-call-start":
        sm.parts[pid] = {
          type: "tool",
          toolName: chunk.toolName,
          input: undefined,
          status: "pending",
          startTime: Date.now(),
        };
        break;
      case "tool-call":
        sm.parts[pid] = {
          type: "tool",
          toolName: chunk.toolName,
          input: (chunk as { input: unknown }).input,
          status: "pending",
          startTime: Date.now(),
        };
        break;
      case "tool-result-start": {
        const tp = sm.parts[pid];
        if (tp && tp.type === "tool") {
          tp.status = "running";
        }
        break;
      }
      case "tool-result": {
        const tr = chunk as { output: string; error?: string };
        const tp = sm.parts[pid];
        if (tp && tp.type === "tool") {
          tp.status = tr.error ? "error" : "success";
          tp.output = tr.output;
          tp.error = tr.error;
          tp.endTime = Date.now();
        }
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
