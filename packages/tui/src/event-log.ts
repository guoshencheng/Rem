import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { dim } from "./colors.js";

interface EventEntry {
  time: string;
  name: string;
  detail: string;
}

export class EventLog extends Container {
  private entries: EventEntry[] = [];
  private maxEntries: number;
  private header: Text;
  private content: Container;

  constructor(maxEntries = 50) {
    super();
    this.maxEntries = maxEntries;
    this.header = new Text("", 1, 0);
    this.content = new Container();
    this.addChild(new Spacer(1));
    this.addChild(this.header);
    this.addChild(this.content);
    this.updateHeader();
  }

  addEvent(name: string, detail = ""): void {
    const time = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    this.entries.push({ time, name, detail });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.refresh();
  }

  clear(): void {
    this.entries = [];
    this.refresh();
  }

  private updateHeader(): void {
    this.header.setText(dim("── Events ──"));
  }

  private refresh(): void {
    this.content.clear();
    for (const entry of this.entries) {
      const line = `[${entry.time}] ${entry.name}${entry.detail ? `  ${entry.detail}` : ""}`;
      this.content.addChild(new Text(dim(line), 1, 0));
    }
  }
}
