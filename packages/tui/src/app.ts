import {
  Container,
  Input,
  Key,
  ProcessTerminal,
  Spacer,
  TUI,
  matchesKey,
} from "@earendil-works/pi-tui";
import type {
  AgentStatus,
  AgentStreamChunk,
  CoreAgent,
  SessionSummary,
  UIAgentSession,
  UISessionCallbacks,
} from "rem-agent-core";
import { createUIAgentSession } from "rem-agent-core";
import { ChatLog } from "./chat-log.js";
import { EventLog } from "./event-log.js";
import { StatusBar } from "./status-bar.js";
import { StreamAssistantMessage } from "./message/stream-message.js";
import { SessionPicker } from "./session-picker.js";
import type { SessionPickerItem } from "./session-picker.js";

export interface TUIAppOptions {
  agent: CoreAgent;
  sessionId?: string;
}

export class TUIApp implements UISessionCallbacks {
  private tui: TUI;
  private chatLog: ChatLog;
  private eventLog: EventLog;
  private statusBar: StatusBar;
  private input: Input;
  private root: Container;
  private agent: CoreAgent;
  private session: UIAgentSession;
  private currentStreamMessage?: StreamAssistantMessage;
  private titleGenerated = false;
  private sessionId?: string;

  constructor(options: TUIAppOptions) {
    this.agent = options.agent;
    this.sessionId = options.sessionId;
    this.session = createUIAgentSession(this.agent);
    this.session.setCallbacks(this);

    this.chatLog = new ChatLog();
    this.eventLog = new EventLog();
    this.statusBar = new StatusBar(this.session.maxTurns);
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
        this.session.submit(trimmed);
      }
    };

    this.input.onEscape = () => {
      this.session.interrupt();
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
    await this.agent.initialize({ sessionId: this.sessionId });
    this.loadHistory();
  }

  start(): void {
    this.tui.start();
    this.tui.setFocus(this.input);
  }

  stop(): void {
    this.tui.stop();
  }

  private loadHistory(): void {
    const messages = this.agent.conversation;
    if (messages.length > 0) {
      this.chatLog.loadMessages(messages);
    }
  }

  private async handleResumeCommand(): Promise<void> {
    const sessions = await this.agent.listSessions();
    if (sessions.length === 0) {
      this.eventLog.addEvent("resume", "no sessions found");
      this.tui.requestRender(true);
      return;
    }

    const items: SessionPickerItem[] = sessions.map((s: SessionSummary) => ({
      sessionId: s.sessionId,
      title: s.title,
      updatedAt: s.updatedAt,
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
    this.agent.interrupt();
    this.currentStreamMessage = undefined;
    this.titleGenerated = false;
    await this.agent.reset();
    this.chatLog.clearMessages();
    this.statusBar.update(0, this.agent.maxTurns, "idle", this.agent.sessionId);
    this.eventLog.addEvent("session", "new session created");
    this.tui.requestRender(true);
  }

  private async switchSession(sessionId: string): Promise<void> {
    this.agent.interrupt();
    this.currentStreamMessage = undefined;
    this.titleGenerated = false;
    this.sessionId = sessionId;
    await this.agent.initialize({ sessionId });
    this.chatLog.clearMessages();
    this.loadHistory();
    this.statusBar.update(this.session.currentTurn, this.session.maxTurns, "idle", sessionId);
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
    return undefined;
  }

  onStart = (): void => {
    this.eventLog.addEvent("core-agent:start");
  };

  onStop = (): void => {
    this.eventLog.addEvent("core-agent:stop");
  };

  onError = (error: Error): void => {
    this.eventLog.addEvent("core-agent:error", error.message);
    this.chatLog.addAssistant(`Error: ${error.message}`);
    this.tui.requestRender(true);
  };

  onStatusChange = (status: AgentStatus): void => {
    const currentTurn = this.session.currentTurn;
    this.statusBar.update(currentTurn, this.session.maxTurns, status);
    this.tui.requestRender(true);
  };

  onTurnChange = (currentTurn: number, maxTurns: number): void => {
    this.statusBar.update(currentTurn, maxTurns, "running");
    this.eventLog.addEvent("turn:before", `turn #${currentTurn}`);
    this.tui.requestRender(true);
  };

  onUserMessage = (text: string): void => {
    this.chatLog.addUser(text);
    this.input.setValue("");
    this.tui.requestRender(true);
  };

  onStreamChunk = (chunk: AgentStreamChunk): void => {
    if (!this.currentStreamMessage) {
      this.currentStreamMessage = this.chatLog.startAssistant();
    }
    this.currentStreamMessage.appendChunk(chunk);

    if (chunk.type === "finish" || chunk.type === "error") {
      this.currentStreamMessage = undefined;
    }

    this.tui.requestRender(true);
  };

  onAssistantMessageFinalized = async (_text: string): Promise<void> => {
    this.currentStreamMessage = undefined;
    this.tui.requestRender(true);

    if (!this.titleGenerated) {
      this.titleGenerated = true;
      try {
        await this.agent.generateTitle();
      } catch {
        /* title generation is non-critical */
      }
    }
  };
}
