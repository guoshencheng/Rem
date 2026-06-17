import { Text } from "@earendil-works/pi-tui";
import { bold, dim, red } from "./colors.js";

export class StatusBar extends Text {
  private maxTurns: number;
  private sessionId = "";

  constructor(maxTurns: number) {
    super("", 1, 0);
    this.maxTurns = maxTurns;
    this.update(0, maxTurns, "idle");
  }

  update(currentTurn: number, maxTurns: number, status: string, sessionId?: string): void {
    this.maxTurns = maxTurns;
    if (sessionId !== undefined) {
      this.sessionId = sessionId;
    }
    const statusColor = status === "running" ? bold : status === "error" ? red : dim;
    const idStr = this.sessionId ? ` | ${dim(this.sessionId.slice(0, 8))}` : "";
    const text = `Core Demo  |  turn: ${currentTurn}/${maxTurns}  |  status: ${statusColor(status)}${idStr}`;
    this.setText(text);
  }
}
