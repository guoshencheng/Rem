import { Text } from "@earendil-works/pi-tui";
import { bold, dim, red } from "../colors.js";

export class StatusBar extends Text {
  constructor() {
    super("", 1, 0);
    this.update(0, 60, "idle");
  }

  update(currentTurn: number, maxTurns: number, status: string): void {
    const statusColor = status === "running" ? bold : status === "error" ? red : dim;
    const text = `Core Demo  |  turn: ${currentTurn}/${maxTurns}  |  status: ${statusColor(status)}`;
    this.setText(text);
  }
}
