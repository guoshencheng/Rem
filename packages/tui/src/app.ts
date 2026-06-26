import {
  createCliRenderer,
  Box,
  Text,
  Input,
  ScrollBox,
  Select,
  TextAttributes,
  InputRenderableEvents,
} from "@opentui/core";
import type { KeyEvent, CliRenderer } from "@opentui/core";
import type { AgentStreamChunk, SessionSummary } from "rem-agent-sdk";
import { AgentClient } from "rem-agent-sdk";
import { getToolFormatter } from "./message/tool-formatter.js";

// ---- types ----

type ToolStatus = "pending" | "running" | "success" | "error";

interface ToolPartState {
  type: "tool";
  toolName: string;
  input?: unknown;
  status: ToolStatus;
  output?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

interface ReasoningPartState {
  type: "reasoning";
  content: string;
  startTime: number;
  duration?: number;
}

interface TextPartState {
  type: "text";
  content: string;
}

type PartState = TextPartState | ReasoningPartState | ToolPartState;

// ---- helpers ----

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function statusIcon(status: ToolStatus): string {
  switch (status) {
    case "pending":
    case "running":
      return "◐";
    case "success":
      return "✓";
    case "error":
      return "✗";
  }
}

function formatDuration(startTime: number, endTime?: number): string {
  if (!endTime) return "";
  const ms = endTime - startTime;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function previewText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 50 ? `${clean.slice(0, 50)}…` : clean;
}

// ---- block helpers ----

interface BlockHandle {
  container: ReturnType<typeof Box>;
  setCollapsed(c: boolean): void;
}

function createReasoningBlock(part: ReasoningPartState, collapsed: boolean): BlockHandle {
  const label = Text({ content: "" as string, attributes: TextAttributes.DIM });
  const body = Text({ content: "" as string, visible: false });

  function update() {
    const base = part.duration != null
      ? `think for ${(part.duration / 1000).toFixed(1)}s`
      : "thinking";
    if (collapsed) {
      const prev = previewText(part.content);
      (label as any).content = `${base}${prev ? `: ${prev}` : ""} > (ctrl+o)`;
    } else {
      (label as any).content = base;
    }
    (body as any).content = part.content;
    (body as any).visible = !collapsed;
  }

  update();

  const container = Box({ flexDirection: "column" }, label, body);

  return {
    container,
    setCollapsed(c: boolean) {
      collapsed = c;
      update();
    },
  };
}

function createToolBlock(part: ToolPartState, collapsed: boolean): BlockHandle {
  const label = Text({ content: "" as string, attributes: TextAttributes.DIM });
  const body = Text({ content: "" as string, visible: false });

  function update() {
    const fmt = getToolFormatter(part.toolName);
    const icon = statusIcon(part.status);
    const call = fmt.formatCall(part.toolName, part.input);
    const dur = formatDuration(part.startTime, part.endTime);

    if (part.status === "pending" || part.status === "running") {
      const hint = collapsed ? " (ctrl+o)" : "";
      (label as any).content = `${icon} ${call} ...${hint}`;
    } else {
      const summary = fmt.formatResultSummary(
        part.toolName, part.input, part.output ?? "", part.error,
      );
      if (collapsed) {
        (label as any).content = `${icon} ${call}  ${summary}  (ctrl+o)`;
      } else {
        (label as any).content = `${icon} ${call}${dur ? ` (${dur})` : ""}`;
      }
    }

    if (!collapsed && (part.status === "success" || part.status === "error")) {
      (body as any).content = fmt.formatResultBody(
        part.toolName, part.input, part.output ?? "", part.error,
      );
      (body as any).visible = true;
    } else {
      (body as any).visible = false;
    }
  }

  update();

  const container = Box({ flexDirection: "column" }, label, body);

  return {
    container,
    setCollapsed(c: boolean) {
      collapsed = c;
      update();
    },
  };
}

// ---- TUIApp ----

export interface TUIAppOptions {
  serverUrl: string;
  sessionId?: string;
  maxTurns?: number;
}

export class TUIApp {
  private renderer!: CliRenderer;
  private client: AgentClient;
  private sessionId: string;
  private maxTurns: number;
  private currentTurn = 0;
  private running = false;

  // UI refs (initialized in buildUI)
  private chatBox!: ReturnType<typeof Box>;
  private statusText!: ReturnType<typeof Text>;
  private inputNode!: ReturnType<typeof Input>;
  private overlayBox!: ReturnType<typeof Box>;

  // Collapse state
  private thinkingCollapsed = true;
  private toolsCollapsed = true;

  // Current stream message tracking
  private streamParts = new Map<string, PartState>();
  private streamContainer: ReturnType<typeof Box> | null = null;
  private streamBlocks = new Map<string, BlockHandle>();

  constructor(options: TUIAppOptions) {
    this.client = new AgentClient(options.serverUrl);
    this.sessionId = options.sessionId ?? generateId();
    this.maxTurns = options.maxTurns ?? 60;
  }

  async init(): Promise<void> {
    this.renderer = await createCliRenderer({
      screenMode: "alternate-screen",
      exitOnCtrlC: false,
      targetFps: 30,
    });

    this.buildUI();
  }

  start(): void {
    this.inputNode.focus();
  }

  stop(): void {
    this.renderer.destroy();
  }

  // ---- UI construction ----

  private buildUI(): void {
    this.statusText = Text({
      content: this.buildStatusText() as string,
      attributes: TextAttributes.DIM,
    });

    this.inputNode = Input({
      placeholder: "Type a message...",
      width: "100%",
    });

    (this.inputNode as any).on(InputRenderableEvents.ENTER, (value: string) => {
      const trimmed = value.trim();
      if (trimmed) {
        this.handleSubmit(trimmed);
      }
    });

    this.overlayBox = Box({
      position: "absolute" as any,
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      zIndex: 100,
      visible: false,
    });

    this.chatBox = Box({ flexDirection: "column", gap: 1 });

    const scrollBox = ScrollBox(
      { flexGrow: 1, stickyStart: "bottom" as any },
      this.chatBox,
    );

    this.renderer.root.add(
      Box(
        { flexDirection: "column", height: "100%" },
        scrollBox,
        this.statusText,
        Box({ marginTop: 1 }, this.inputNode),
        this.overlayBox,
      ),
    );

    this.bindKeys();
  }

  private buildStatusText(): string {
    const id = this.sessionId.slice(0, 8);
    const status = this.running ? "running" : "idle";
    return `Core Demo  |  turn: ${this.currentTurn}/${this.maxTurns}  |  status: ${status}  |  ${id}`;
  }

  private updateStatus(): void {
    (this.statusText as any).content = this.buildStatusText();
  }

  private bindKeys(): void {
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      if (key.ctrl && key.name === "c") {
        this.stop();
        process.exit(0);
      }
      if (key.ctrl && key.name === "o") {
        this.thinkingCollapsed = !this.thinkingCollapsed;
        this.toolsCollapsed = !this.toolsCollapsed;
        for (const block of this.streamBlocks.values()) {
          block.setCollapsed(this.thinkingCollapsed);
        }
      }
      if (key.name === "escape") {
        if ((this.overlayBox as any).visible) {
          this.hidePicker();
        } else if (this.running) {
          this.client.interrupt(this.sessionId).catch(() => {});
        }
      }
    });
  }

  // ---- message rendering ----

  private addUserText(text: string): void {
    (this.chatBox as any).add(
      Box({ padding: 1 }, Text({ content: text as string })),
    );
  }

  private addAssistantText(text: string): void {
    (this.chatBox as any).add(
      Box({ padding: 1 }, Text({ content: text as string })),
    );
  }

  private clearChat(): void {
    // Remove all children by clearing and re-adding chatBox
    const parent = (this.chatBox as any).parent;
    // Actually, just create a new chat box
    this.chatBox = Box({ flexDirection: "column", gap: 1 });
    // Re-add to the scrollBox's content
  }

  // ---- submit & streaming ----

  private async handleSubmit(text: string): Promise<void> {
    if (text === "/new") {
      await this.handleNewSession();
      return;
    }
    if (text === "/resume") {
      await this.handleResumeCommand();
      return;
    }

    if (this.running) return;
    if (this.currentTurn >= this.maxTurns) {
      this.addAssistantText("Maximum turns reached. Start a new session with /new.");
      return;
    }

    this.running = true;
    this.currentTurn++;
    this.addUserText(text);
    (this.inputNode as any).value = "";
    this.updateStatus();

    this.startStreamMessage();

    try {
      const stream = await this.client.run(this.sessionId, text);
      for await (const chunk of stream) {
        this.handleChunk(chunk);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (this.streamContainer && this.streamParts.size === 0) {
        (this.chatBox as any).add(
          Box({ padding: 1 }, Text({ content: `Error: ${msg}` as string })),
        );
      }
      this.endStream();
      this.running = false;
      this.updateStatus();
    }
  }

  private startStreamMessage(): void {
    this.streamParts.clear();
    this.streamBlocks.clear();
    this.streamContainer = Box({ flexDirection: "column" });
    (this.chatBox as any).add(this.streamContainer);
  }

  private endStream(): void {
    this.streamContainer = null;
    this.streamParts.clear();
    this.streamBlocks.clear();
  }

  private handleChunk(chunk: AgentStreamChunk): void {
    if (!this.streamContainer) return;

    const container = this.streamContainer as any;

    switch (chunk.type) {
      case "text-start":
      case "text-delta": {
        const existing = this.streamParts.get(chunk.partId);
        if (existing && existing.type === "text" && chunk.type === "text-delta") {
          existing.content += (chunk as { text: string }).text;
        } else if (chunk.type === "text-delta") {
          const part: TextPartState = { type: "text", content: (chunk as { text: string }).text };
          this.streamParts.set(chunk.partId, part);
          container.add(
            Box({ padding: 1 }, Text({ content: part.content as string, id: chunk.partId })),
          );
        } else {
          this.streamParts.set(chunk.partId, { type: "text", content: "" });
        }
        break;
      }
      case "reasoning-start": {
        const part: ReasoningPartState = { type: "reasoning", content: "", startTime: Date.now() };
        this.streamParts.set(chunk.partId, part);
        const block = createReasoningBlock(part, this.thinkingCollapsed);
        this.streamBlocks.set(chunk.partId, block);
        container.add(block.container);
        break;
      }
      case "reasoning-delta": {
        const part = this.streamParts.get(chunk.partId);
        if (part && part.type === "reasoning") {
          part.content += chunk.text;
        }
        break;
      }
      case "reasoning-finish": {
        const part = this.streamParts.get(chunk.partId);
        if (part && part.type === "reasoning") {
          part.duration = Date.now() - part.startTime;
        }
        break;
      }
      case "tool-call-start":
      case "tool-call": {
        const part: ToolPartState = {
          type: "tool",
          toolName: chunk.toolName,
          input: (chunk as { input?: unknown }).input,
          status: "pending",
          startTime: Date.now(),
        };
        this.streamParts.set(chunk.partId, part);
        const block = createToolBlock(part, this.toolsCollapsed);
        this.streamBlocks.set(chunk.partId, block);
        container.add(block.container);
        break;
      }
      case "tool-result-start": {
        const part = this.streamParts.get(chunk.partId);
        if (part && part.type === "tool") {
          part.status = "running";
        }
        break;
      }
      case "tool-result": {
        const part = this.streamParts.get(chunk.partId);
        if (part && part.type === "tool") {
          part.status = (chunk as { error?: string }).error ? "error" : "success";
          part.output = (chunk as { output: string }).output;
          part.error = (chunk as { error?: string }).error;
          part.endTime = Date.now();
        }
        break;
      }
      case "finish": {
        if (this.streamParts.size === 0 && chunk.output.content) {
          container.add(
            Box({ padding: 1 }, Text({ content: chunk.output.content as string })),
          );
        }
        this.endStream();
        this.running = false;
        this.updateStatus();
        break;
      }
      case "error": {
        const msg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
        if (this.streamParts.size === 0) {
          container.add(
            Box({ padding: 1 }, Text({ content: `Error: ${msg}` as string })),
          );
        }
        this.endStream();
        this.running = false;
        this.updateStatus();
        break;
      }
    }
  }

  // ---- commands ----

  private async handleNewSession(): Promise<void> {
    this.client.interrupt(this.sessionId).catch(() => {});
    this.currentTurn = 0;
    this.running = false;
    this.sessionId = generateId();
    // Clear chat by removing all children
    this.clearChatBox();
    this.updateStatus();
  }

  private clearChatBox(): void {
    // VNode `remove` chaining: remove children one by one
    // Since VNodes proxy method calls, just try to clear
    try {
      const box = this.chatBox as any;
      // Iterate and remove children
      if (typeof box.clear === "function") {
        box.clear();
      }
    } catch {
      // Fallback: recreate the chat box
      this.chatBox = Box({ flexDirection: "column", gap: 1 });
    }
  }

  private async handleResumeCommand(): Promise<void> {
    const sessions = await this.client.listSessions();
    if (sessions.length === 0) {
      this.addAssistantText("No sessions found.");
      return;
    }
    this.showPicker(sessions);
  }

  private showPicker(sessions: SessionSummary[]): void {
    const options = sessions.map((s) => ({
      name: s.title
        ? `${s.title} (${s.sessionId.slice(0, 8)})`
        : s.sessionId.slice(0, 8),
      description: `${s.messageCount} messages`,
      value: s.sessionId,
    }));

    const selectNode = Select({ options });

    (selectNode as any).on("select", (_index: number, option: { value: string } | null) => {
      if (option) {
        this.hidePicker();
        this.switchSession(option.value);
      }
    });

    const box = this.overlayBox as any;
    // Remove previous overlay content
    // OverlayBox doesn't have clear, so just set visible and re-add
    box.visible = true;

    box.add(
      Box(
        {
          position: "absolute" as any,
          left: "25%",
          top: "25%",
          width: "50%",
          height: "50%",
          borderStyle: "rounded",
          padding: 2,
          flexDirection: "column",
        },
        Text({ content: "Select Session (Esc to cancel)" as string, fg: "#FFFF00" }),
        Box({ flexGrow: 1 }, selectNode),
      ),
    );

    selectNode.focus();
  }

  private hidePicker(): void {
    (this.overlayBox as any).visible = false;
    this.inputNode.focus();
  }

  private async switchSession(sessionId: string): Promise<void> {
    this.client.interrupt(this.sessionId).catch(() => {});
    this.sessionId = sessionId;
    this.currentTurn = 0;
    this.running = false;
    this.clearChatBox();
    this.updateStatus();
  }
}
