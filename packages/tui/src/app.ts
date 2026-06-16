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
  UIAgentSession,
  UISessionCallbacks,
} from "@agent-harness/core";
import { ChatLog } from "./chat-log.js";
import { EventLog } from "./event-log.js";
import { StatusBar } from "./status-bar.js";
import { StreamAssistantMessage } from "./message/stream-message.js";

export interface TUIAppOptions {
  session: UIAgentSession;
}

export class TUIApp implements UISessionCallbacks {
  private tui: TUI;
  private chatLog: ChatLog;
  private eventLog: EventLog;
  private statusBar: StatusBar;
  private input: Input;
  private root: Container;
  private session: UIAgentSession;
  private currentStreamMessage?: StreamAssistantMessage;

  constructor(options: TUIAppOptions) {
    this.session = options.session;
    this.session.setCallbacks(this);

    this.chatLog = new ChatLog();
    this.eventLog = new EventLog();
    this.statusBar = new StatusBar(options.session.maxTurns);
    this.input = new Input();

    this.input.onSubmit = (value: string) => {
      if (value.trim()) {
        this.session.submit(value);
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

  start(): void {
    this.tui.start();
    this.tui.setFocus(this.input);
  }

  stop(): void {
    this.tui.stop();
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

  onAssistantMessageFinalized = (_text: string): void => {
    this.currentStreamMessage = undefined;
    this.tui.requestRender(true);
  };
}
