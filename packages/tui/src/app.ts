import {
  Container,
  Input,
  Key,
  ProcessTerminal,
  Spacer,
  TUI,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { AgentStreamChunk, SessionSummary } from "rem-agent-sdk";
import { AgentClient } from "rem-agent-sdk";
import { ChatLog } from "./chat-log.js";
import { EventLog } from "./event-log.js";
import { StatusBar } from "./status-bar.js";
import { StreamAssistantMessage } from "./message/stream-message.js";
import { SessionPicker } from "./session-picker.js";
import type { SessionPickerItem } from "./session-picker.js";

export interface TUIAppOptions {
  serverUrl: string;
  sessionId?: string;
  maxTurns?: number;
}

export class TUIApp {
  private tui: TUI;
  private chatLog: ChatLog;
  private eventLog: EventLog;
  private statusBar: StatusBar;
  private input: Input;
  private root: Container;
  private client: AgentClient;
  private sessionId: string;
  private currentStreamMessage?: StreamAssistantMessage;
  private titleGenerated = false;
  private maxTurns: number;
  private currentTurn = 0;

  constructor(options: TUIAppOptions) {
    this.client = new AgentClient(options.serverUrl);
    this.sessionId = options.sessionId ?? this.generateId();
    this.maxTurns = options.maxTurns ?? 60;

    this.chatLog = new ChatLog();
    this.eventLog = new EventLog();
    this.statusBar = new StatusBar(this.maxTurns);
    this.input = new Input();

    this.input.onSubmit = async (value: string) => {
      const trimmed = value.trim();
      if (trimmed === "/resume") {
        this.input.setValue("");
        this.tui.requestRender(true);
        await this.handleResumeCommand();
        return;
      }
      if (trimmed === "/new") {
        this.input.setValue("");
        this.tui.requestRender(true);
        await this.handleNewSession();
        return;
      }
      if (trimmed) {
        this.submit(trimmed);
      }
    };

    this.input.onEscape = () => {
      this.client.interrupt(this.sessionId).catch(() => {});
    };

    this.root = new Container();
    this.root.addChild(this.chatLog);
    this.root.addChild(this.eventLog);
    this.root.addChild(new Spacer(1));
    this.root.addChild(this.statusBar);
    this.root.addChild(this.input);

    this.tui = new TUI(new ProcessTerminal(), true);
    this.tui.addInputListener((data) => this.handleGlobalInput(data));
    this.tui.addChild(this.root);
  }

  async init(): Promise<void> {
    // No direct agent initialization needed; session is created lazily on server.
  }

  start(): void {
    this.tui.start();
    this.tui.setFocus(this.input);
  }

  stop(): void {
    this.tui.stop();
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private async handleResumeCommand(): Promise<void> {
    const sessions = await this.client.listSessions();
    if (sessions.length === 0) {
      this.eventLog.addEvent("resume", "no sessions found");
      this.tui.requestRender(true);
      return;
    }

    const items: SessionPickerItem[] = sessions.map((s: SessionSummary) => ({
      sessionId: s.sessionId,
      title: s.title,
      updatedAt: new Date(s.updatedAt),
      messageCount: s.messageCount,
    }));

    const picker = new SessionPicker(items, {
      onSelect: async (sessionId: string) => {
        handle.hide();
        this.tui.setFocus(this.input);
        await this.switchSession(sessionId);
      },
      onCancel: () => {
        handle.hide();
        this.tui.setFocus(this.input);
      },
    });

    const handle = this.tui.showOverlay(picker, {
      anchor: "center",
      width: "60%",
    });
  }

  private async handleNewSession(): Promise<void> {
    this.client.interrupt(this.sessionId).catch(() => {});
    this.currentStreamMessage = undefined;
    this.titleGenerated = false;
    this.currentTurn = 0;
    this.sessionId = this.generateId();
    this.chatLog.clearMessages();
    this.statusBar.update(0, this.maxTurns, "idle", this.sessionId);
    this.eventLog.addEvent("session", "new session created");
    this.tui.requestRender(true);
  }

  private async switchSession(sessionId: string): Promise<void> {
    this.client.interrupt(this.sessionId).catch(() => {});
    this.currentStreamMessage = undefined;
    this.titleGenerated = false;
    this.sessionId = sessionId;
    this.currentTurn = 0;
    this.chatLog.clearMessages();
    this.statusBar.update(0, this.maxTurns, "idle", sessionId);
    this.eventLog.addEvent("resume", `loaded session ${sessionId.slice(0, 8)}`);
    this.tui.requestRender(true);
  }

  private handleGlobalInput(data: string) {
    if (matchesKey(data, "ctrl+c")) {
      this.stop();
      process.exit(0);
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl("o"))) {
      this.chatLog.toggleThinkingCollapsed();
      this.tui.requestRender(true);
      return { consume: true };
    }
    return undefined;
  }

  private async submit(text: string): Promise<void> {
    this.chatLog.addUser(text);
    this.input.setValue("");
    this.statusBar.update(this.currentTurn, this.maxTurns, "running");
    this.eventLog.addEvent("turn:before", `turn #${this.currentTurn}`);
    this.tui.requestRender(true);

    this.currentStreamMessage = this.chatLog.startAssistant();

    try {
      const stream = await this.client.run(this.sessionId, text);
      for await (const chunk of stream) {
        this.handleChunk(chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.eventLog.addEvent("core-agent:error", message);
      this.chatLog.addAssistant(`Error: ${message}`);
      this.statusBar.update(this.currentTurn, this.maxTurns, "error");
      this.tui.requestRender(true);
    }
  }

  private handleChunk(chunk: AgentStreamChunk): void {
    if (!this.currentStreamMessage) {
      this.currentStreamMessage = this.chatLog.startAssistant();
    }
    this.currentStreamMessage.appendChunk(chunk);

    if (chunk.type === "finish" || chunk.type === "error") {
      this.currentStreamMessage = undefined;
      this.statusBar.update(
        this.currentTurn,
        this.maxTurns,
        "idle",
        this.sessionId,
      );
    }

    this.tui.requestRender(true);
  }
}
