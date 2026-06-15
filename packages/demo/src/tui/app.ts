import {
  Container,
  Input,
  ProcessTerminal,
  Spacer,
  TUI,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { ChatLog } from "./chat-log.js";
import { EventLog } from "./event-log.js";
import { StatusBar } from "./status-bar.js";
import { StreamAssistantMessage } from "./message.js";
import type { ModelMessage } from "@agent-harness/core";

export interface AppCallbacks {
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onQuit: () => void;
}

export class App {
  private tui: TUI;
  private chatLog: ChatLog;
  private eventLog: EventLog;
  private statusBar: StatusBar;
  private input: Input;
  private root: Container;
  private maxTurns: number;

  constructor(maxTurns: number, callbacks: AppCallbacks) {
    this.maxTurns = maxTurns;

    this.chatLog = new ChatLog();
    this.eventLog = new EventLog();
    this.statusBar = new StatusBar();
    this.input = new Input();

    this.input.onSubmit = (value: string) => {
      if (value.trim()) {
        callbacks.onSubmit(value);
      }
    };

    this.input.onEscape = () => {
      callbacks.onInterrupt();
    };

    this.root = new Container();
    this.root.addChild(this.chatLog);
    this.root.addChild(this.eventLog);
    this.root.addChild(new Spacer(1));
    this.root.addChild(this.statusBar);
    this.root.addChild(this.input);

    this.tui = new TUI(new ProcessTerminal(), true);
    this.tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c")) {
        callbacks.onQuit();
        return { consume: true };
      }
      return undefined;
    });
    this.tui.addChild(this.root);
  }

  start(): void {
    this.tui.start();
    this.tui.setFocus(this.input);
  }

  stop(): void {
    this.tui.stop();
  }

  addUserMessage(text: string): void {
    this.chatLog.addUser(text);
    this.tui.requestRender(true);
  }

  addAssistantMessage(text: string): void {
    this.chatLog.addAssistant(text);
    this.tui.requestRender(true);
  }

  startAssistantMessage(): StreamAssistantMessage {
    return this.chatLog.startAssistant();
  }

  finalizeAssistantMessage(_text: string): void {
    this.tui.requestRender(true);
  }

  updateConversation(_messages: ModelMessage[]): void {
    this.tui.requestRender(true);
  }

  requestRender(): void {
    this.tui.requestRender(true);
  }

  addEvent(name: string, detail?: string): void {
    this.eventLog.addEvent(name, detail);
    this.tui.requestRender(true);
  }

  updateStatus(currentTurn: number, status: string): void {
    this.statusBar.update(currentTurn, this.maxTurns, status);
    this.tui.requestRender(true);
  }

  clearInput(): void {
    this.input.setValue("");
    this.tui.requestRender(true);
  }
}
