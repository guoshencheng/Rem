import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
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
  label: TextRenderable;
  body: TextRenderable;
  container: BoxRenderable;
  setCollapsed(c: boolean): void;
}

function createReasoningBlock(
  renderer: CliRenderer,
  part: ReasoningPartState,
  collapsed: boolean,
): BlockHandle {
  const label = new TextRenderable(renderer, {
    content: "",
    attributes: TextAttributes.DIM,
  });
  const body = new TextRenderable(renderer, {
    content: part.content,
    visible: !collapsed,
  });

  function update() {
    const base = part.duration != null
      ? `think for ${(part.duration / 1000).toFixed(1)}s`
      : "thinking";
    if (collapsed) {
      const prev = previewText(part.content);
      label.content = `${base}${prev ? `: ${prev}` : ""} > (ctrl+o)`;
    } else {
      label.content = base;
    }
    body.content = part.content;
    body.visible = !collapsed;
  }

  update();

  const container = new BoxRenderable(renderer, { flexDirection: "column" });
  container.add(label);
  container.add(body);

  return {
    label,
    body,
    container,
    setCollapsed(c: boolean) {
      collapsed = c;
      update();
    },
  };
}

function createToolBlock(
  renderer: CliRenderer,
  part: ToolPartState,
  collapsed: boolean,
): BlockHandle {
  const label = new TextRenderable(renderer, {
    content: "",
    attributes: TextAttributes.DIM,
  });
  const body = new TextRenderable(renderer, {
    content: "",
    visible: false,
  });

  function update() {
    const fmt = getToolFormatter(part.toolName);
    const icon = statusIcon(part.status);
    const call = fmt.formatCall(part.toolName, part.input);
    const dur = formatDuration(part.startTime, part.endTime);

    if (part.status === "pending" || part.status === "running") {
      const hint = collapsed ? " (ctrl+o)" : "";
      label.content = `${icon} ${call} ...${hint}`;
    } else {
      const summary = fmt.formatResultSummary(
        part.toolName, part.input, part.output ?? "", part.error,
      );
      if (collapsed) {
        label.content = `${icon} ${call}  ${summary}  (ctrl+o)`;
      } else {
        label.content = `${icon} ${call}${dur ? ` (${dur})` : ""}`;
      }
    }

    if (!collapsed && (part.status === "success" || part.status === "error")) {
      body.content = fmt.formatResultBody(
        part.toolName, part.input, part.output ?? "", part.error,
      );
      body.visible = true;
    } else {
      body.visible = false;
    }
  }

  update();

  const container = new BoxRenderable(renderer, { flexDirection: "column" });
  container.add(label);
  container.add(body);

  return {
    label,
    body,
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

  // UI refs
  private chatBox!: BoxRenderable;
  private statusText!: TextRenderable;
  private inputNode!: InputRenderable;
  private overlayBox!: BoxRenderable;

  // Collapse state
  private thinkingCollapsed = true;
  private toolsCollapsed = true;

  // Stream tracking
  private streamParts = new Map<string, ToolPartState | ReasoningPartState>();
  private streamContainer: BoxRenderable | null = null;
  private streamBlocks = new Map<string, BlockHandle>();
  private streamTextRefs = new Map<string, TextRenderable>();

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
    // Status bar
    this.statusText = new TextRenderable(this.renderer, {
      content: this.buildStatusText(),
      attributes: TextAttributes.DIM,
    });

    // Input
    this.inputNode = new InputRenderable(this.renderer, {
      placeholder: "Type a message...",
      width: "100%",
    });
    this.inputNode.on(InputRenderableEvents.ENTER, (value: string) => {
      const trimmed = value.trim();
      if (trimmed) this.handleSubmit(trimmed);
    });

    // Overlay (hidden initially)
    this.overlayBox = new BoxRenderable(this.renderer, {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      zIndex: 100,
      visible: false,
    });

    // Chat area
    this.chatBox = new BoxRenderable(this.renderer, {
      flexDirection: "column",
      gap: 1,
    });

    const scrollBox = new ScrollBoxRenderable(this.renderer, {
      flexGrow: 1,
      stickyStart: "bottom",
    });
    scrollBox.add(this.chatBox);

    // Root layout
    const root = new BoxRenderable(this.renderer, {
      flexDirection: "column",
      height: "100%",
    });
    root.add(scrollBox);
    root.add(this.statusText);

    const inputRow = new BoxRenderable(this.renderer, { marginTop: 1 });
    inputRow.add(this.inputNode);
    root.add(inputRow);

    root.add(this.overlayBox);

    this.renderer.root.add(root);

    this.bindKeys();
  }

  private buildStatusText(): string {
    const id = this.sessionId.slice(0, 8);
    const status = this.running ? "running" : "idle";
    return `Core Demo  |  turn: ${this.currentTurn}/${this.maxTurns}  |  status: ${status}  |  ${id}`;
  }

  private updateStatus(): void {
    this.statusText.content = this.buildStatusText();
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
        if (this.overlayBox.visible) {
          this.hidePicker();
        } else if (this.running) {
          this.client.interrupt(this.sessionId).catch(() => {});
        }
      }
    });
  }

  // ---- messages ----

  private addUserText(text: string): void {
    const box = new BoxRenderable(this.renderer, { id: this.nextMsgId(), padding: 1 });
    box.add(new TextRenderable(this.renderer, { content: text }));
    this.chatBox.add(box);
  }

  private addAssistantText(text: string): void {
    const box = new BoxRenderable(this.renderer, { id: this.nextMsgId(), padding: 1 });
    box.add(new TextRenderable(this.renderer, { content: text }));
    this.chatBox.add(box);
  }

  private _chatMsgId = 0;

  private clearChat(): void {
    // Track child counts before clearing
    const count = this._chatMsgId;
    for (let i = 1; i <= count; i++) {
      this.chatBox.remove(`msg-${i}`);
    }
    this._chatMsgId = 0;
  }

  private nextMsgId(): string {
    this._chatMsgId++;
    return `msg-${this._chatMsgId}`;
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
    this.inputNode.value = "";
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
        this.addAssistantText(`Error: ${msg}`);
      }
      this.endStream();
      this.running = false;
      this.updateStatus();
    }
  }

  private startStreamMessage(): void {
    this.streamParts.clear();
    this.streamBlocks.clear();
    this.streamTextRefs.clear();
    this.streamContainer = new BoxRenderable(this.renderer, {
      id: this.nextMsgId(),
      flexDirection: "column",
    });
    this.chatBox.add(this.streamContainer);
  }

  private endStream(): void {
    this.streamContainer = null;
    this.streamParts.clear();
    this.streamBlocks.clear();
    this.streamTextRefs.clear();
  }

  private handleChunk(chunk: AgentStreamChunk): void {
    if (!this.streamContainer) return;

    switch (chunk.type) {
      case "text-start":
        this.streamParts.set(chunk.partId, {} as ToolPartState);
        break;

      case "text-delta": {
        const existing = this.streamTextRefs.get(chunk.partId);
        if (existing) {
          existing.content += chunk.text;
        } else {
          const text = new TextRenderable(this.renderer, { content: chunk.text });
          this.streamTextRefs.set(chunk.partId, text);
          const box = new BoxRenderable(this.renderer, { padding: 1 });
          box.add(text);
          this.streamContainer.add(box);
        }
        break;
      }

      case "reasoning-start": {
        const part: ReasoningPartState = {
          type: "reasoning", content: "", startTime: Date.now(),
        };
        this.streamParts.set(chunk.partId, part);
        const block = createReasoningBlock(this.renderer, part, this.thinkingCollapsed);
        block.container.id = `block-${chunk.partId}`;
        this.streamBlocks.set(chunk.partId, block);
        this.streamContainer.add(block.container);
        break;
      }

      case "reasoning-delta": {
        const part = this.streamParts.get(chunk.partId);
        if (part && part.type === "reasoning") {
          part.content += chunk.text;
          const block = this.streamBlocks.get(chunk.partId);
          if (block) {
            block.setCollapsed(this.thinkingCollapsed);
          }
        }
        break;
      }

      case "reasoning-finish": {
        const part = this.streamParts.get(chunk.partId);
        if (part && part.type === "reasoning") {
          part.duration = Date.now() - part.startTime;
          const block = this.streamBlocks.get(chunk.partId);
          if (block) {
            block.setCollapsed(this.thinkingCollapsed);
          }
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
        const oldBlock = this.streamBlocks.get(chunk.partId);
        if (oldBlock) {
          this.streamContainer.remove(`block-${chunk.partId}`);
        }
        const block = createToolBlock(this.renderer, part, this.toolsCollapsed);
        block.container.id = `block-${chunk.partId}`;
        this.streamBlocks.set(chunk.partId, block);
        this.streamContainer.add(block.container);
        break;
      }

      case "tool-result-start": {
        const part = this.streamParts.get(chunk.partId);
        if (part && part.type === "tool") {
          part.status = "running";
          const block = this.streamBlocks.get(chunk.partId);
          if (block) block.setCollapsed(this.toolsCollapsed);
        }
        break;
      }

      case "tool-result": {
        const tr = chunk as { output: string; error?: string };
        const part = this.streamParts.get(chunk.partId);
        if (part && part.type === "tool") {
          part.status = tr.error ? "error" : "success";
          part.output = tr.output;
          part.error = tr.error;
          part.endTime = Date.now();
          const block = this.streamBlocks.get(chunk.partId);
          if (block) block.setCollapsed(this.toolsCollapsed);
        }
        break;
      }

      case "finish": {
        if (this.streamParts.size === 0 && chunk.output.content) {
          this.addAssistantText(chunk.output.content);
        }
        this.endStream();
        this.running = false;
        this.updateStatus();
        break;
      }

      case "error": {
        const msg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
        if (this.streamParts.size === 0) {
          this.addAssistantText(`Error: ${msg}`);
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
    this.clearChat();
    this.updateStatus();
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

    // Clear previous overlay content
    this.overlayBox.remove("picker-content");
    this.overlayBox.remove("picker-select");

    const selectNode = new SelectRenderable(this.renderer, { id: "picker-select", options });
    selectNode.on("select", (_index: number, option: { value: string } | null) => {
      if (option) {
        this.hidePicker();
        this.switchSession(option.value);
      }
    });

    const pickerBox = new BoxRenderable(this.renderer, {
      position: "absolute",
      left: "25%",
      top: "25%",
      width: "50%",
      height: "50%",
      borderStyle: "rounded",
      padding: 2,
      flexDirection: "column",
    });
    pickerBox.add(new TextRenderable(this.renderer, {
      content: "Select Session (Esc to cancel)",
      fg: "#FFFF00",
    }));
    const selectWrapper = new BoxRenderable(this.renderer, { flexGrow: 1 });
    selectWrapper.add(selectNode);
    pickerBox.add(selectWrapper);

    this.overlayBox.add(pickerBox);
    this.overlayBox.visible = true;
    selectNode.focus();
  }

  private hidePicker(): void {
    this.overlayBox.visible = false;
    this.inputNode.focus();
  }

  private async switchSession(sessionId: string): Promise<void> {
    this.client.interrupt(this.sessionId).catch(() => {});
    this.sessionId = sessionId;
    this.currentTurn = 0;
    this.running = false;
    this.clearChat();
    this.updateStatus();
  }
}
