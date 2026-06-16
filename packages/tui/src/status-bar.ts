import { Text } from "@earendil-works/pi-tui";
import { bold, dim, red } from "./colors.js";

export class StatusBar extends Text {
  private maxTurns: number;

  constructor(maxTurns: number) {
    super("", 1, 0);
    this.maxTurns = maxTurns;
    this.update(0, maxTurns, "idle");
  }

  update(currentTurn: number, maxTurns: number, status: string): void {
    this.maxTurns = maxTurns;
    const statusColor = status === "running" ? bold : status === "error" ? red : dim;
    const text = `Core Demo  |  turn: ${currentTurn}/${maxTurns}  |  status: ${statusColor(status)}`;
    this.setText(text);
  }
}
