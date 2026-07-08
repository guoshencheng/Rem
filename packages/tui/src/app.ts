import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
} from "@opentui/core";
import type { KeyEvent, CliRenderer } from "@opentui/core";
import type { AgentStreamChunk, SessionSummary, IAgentService } from "rem-agent-bridge";
import { reduceStreamChunk } from "rem-agent-bridge";
import type { ContentPart } from "rem-agent-bridge";
import { createReasoningBlock } from "./message/reasoning-block.js";
import type { ReasoningPartState, ReasoningBlockHandle } from "./message/reasoning-block.js";
import { createToolBlock } from "./message/function-tool-block.js";
import type { ToolPartState, ToolBlockHandle } from "./message/function-tool-block.js";
import { buildUI } from "./ui-layout.js";
import { showPicker, hidePicker, switchSession } from "./session-picker.js";
import { handleNewSession, handleResumeCommand, generateId } from "./commands.js";

export interface TUIAppOptions {
  agentService: IAgentService;
  sessionId?: string;
  maxTurns?: number;
  workspace?: string;
}

export class TUIApp {
  private renderer!: CliRenderer;
  private agentService: IAgentService;
  private sessionId: string;
  private maxTurns: number;
  private workspace: string;
  private currentTurn = 0;
  private running = false;

  private chatBox!: BoxRenderable;
  private statusText!: TextRenderable;
  private inputNode!: InputRenderable;
  private overlayBox!: BoxRenderable;

  private thinkingCollapsed = true;
  private toolsCollapsed = true;

  private _streamParts: ContentPart[] = [];
  private streamContainer: BoxRenderable | null = null;
  private streamBlocks = new Map<string, ReasoningBlockHandle | ToolBlockHandle>();
  private streamTextRefs = new Map<string, TextRenderable>();

  constructor(options: TUIAppOptions) {
    this.agentService = options.agentService;
    this.sessionId = options.sessionId ?? generateId();
    this.maxTurns = options.maxTurns ?? 60;
    this.workspace = options.workspace ?? 'default';
  }

  async init(): Promise<void> {
    this.renderer = await createCliRenderer({
      screenMode: "alternate-screen",
      exitOnCtrlC: false,
      targetFps: 30,
    });

    const layout = buildUI(this.renderer);
    this.statusText = layout.statusText;
    this.inputNode = layout.inputNode;
    this.overlayBox = layout.overlayBox;
    this.chatBox = layout.chatBox;

    this.bindKeys();
    this.updateStatus();
  }

  start(): void {
    this.inputNode.focus();
  }

  stop(): void {
    this.renderer.destroy();
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
      if (key.name === "return" || key.name === "enter") {
        const value: string = (this.inputNode as unknown as { value: string }).value ?? "";
        const trimmed = value.trim();
        if (trimmed) {
          this.handleSubmit(trimmed).catch((err) => {
            process.stderr.write(`[TUI] submit error: ${String(err)}\n`);
          });
        }
      }
      if (key.name === "escape") {
        if (this.overlayBox.visible) {
          hidePicker({ overlayBox: this.overlayBox, inputNode: this.inputNode });
        } else if (this.running) {
          this.agentService.interrupt(this.workspace, this.sessionId).catch(() => {});
        }
      }
    });
  }

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

  private async handleSubmit(text: string): Promise<void> {
    if (text === "/new") {
      await handleNewSession({
        agentService: this.agentService,
        workspace: this.workspace,
        sessionId: this.sessionId,
        onNewSession: (id: string) => {
          this.currentTurn = 0;
          this.running = false;
          this.sessionId = id;
        },
        onClearChat: () => this.clearChat(),
        onUpdateStatus: () => this.updateStatus(),
      });
      return;
    }
    if (text === "/resume") {
      await handleResumeCommand({
        agentService: this.agentService,
        workspace: this.workspace,
        onShowPicker: (sessions: SessionSummary[]) => this.showPicker(sessions),
        onAddAssistantText: (text: string) => this.addAssistantText(text),
      });
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
      await this.agentService.run(this.workspace, this.sessionId, text);
      // TODO(server-driven-run): tui 尚未迁移到 bus，流式渲染暂时失效。
      // 后续应订阅 AgentService.stream() 并按 BusEvent 渲染（含 message-start/snapshot/chunk）。
      this.endStream();
      this.running = false;
      this.updateStatus();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (this.streamContainer && this._streamParts.length === 0) {
        this.addAssistantText(`Error: ${msg}`);
      }
      this.endStream();
      this.running = false;
      this.updateStatus();
    }
  }

  private showPicker(sessions: SessionSummary[]): void {
    showPicker({
      renderer: this.renderer,
      overlayBox: this.overlayBox,
      sessions,
      onSelect: (sessionId: string) => {
        hidePicker({ overlayBox: this.overlayBox, inputNode: this.inputNode });
        switchSession({
          agentService: this.agentService,
          workspace: this.workspace,
          currentSessionId: this.sessionId,
          onClearChat: () => this.clearChat(),
          onUpdateStatus: () => this.updateStatus(),
        }).catch(() => {});
        this.sessionId = sessionId;
        this.currentTurn = 0;
        this.running = false;
        this.updateStatus();
      },
    });
  }

  private startStreamMessage(): void {
    this._streamParts = [];
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
    this._streamParts = [];
    this.streamBlocks.clear();
    this.streamTextRefs.clear();
  }

  private handleChunk(chunk: AgentStreamChunk): void {
    if (!this.streamContainer) return;

    this._streamParts = reduceStreamChunk(this._streamParts, chunk);

    switch (chunk.type) {
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
        const rp: ReasoningPartState = {
          type: "reasoning", content: "", startTime: Date.now(),
        };
        const block = createReasoningBlock(this.renderer, rp, this.thinkingCollapsed);
        block.container.id = `block-${chunk.partId}`;
        this.streamBlocks.set(chunk.partId, block);
        this.streamContainer.add(block.container);
        break;
      }

      case "reasoning-delta": {
        const block = this.streamBlocks.get(chunk.partId);
        if (block) {
          block.setCollapsed(this.thinkingCollapsed);
        }
        break;
      }

      case "reasoning-finish": {
        const block = this.streamBlocks.get(chunk.partId);
        if (block) {
          block.setCollapsed(this.thinkingCollapsed);
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
        const block = this.streamBlocks.get(chunk.partId);
        if (block) block.setCollapsed(this.toolsCollapsed);
        break;
      }

      case "tool-result": {
        const block = this.streamBlocks.get(chunk.partId);
        if (block) block.setCollapsed(this.toolsCollapsed);
        break;
      }

      case "finish": {
        if (this._streamParts.length === 0 && chunk.output.content) {
          this.addAssistantText(chunk.output.content);
        }
        this.endStream();
        this.running = false;
        this.updateStatus();
        break;
      }

      case "error": {
        const msg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
        if (this._streamParts.length === 0) {
          this.addAssistantText(`Error: ${msg}`);
        }
        this.endStream();
        this.running = false;
        this.updateStatus();
        break;
      }
    }
  }
}
