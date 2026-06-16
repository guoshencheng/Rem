import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { dim } from "../colors.js";
import { markdownTheme, thinkingMessageStyle } from "../theme.js";

export class ReasoningBlock extends Container {
  private label: Text;
  private body: Markdown;
  private text = "";
  private startTime: number;

  constructor() {
    super();
    this.startTime = Date.now();
    this.label = new Text("thinking", 0, 0, dim);
    this.body = new Markdown("", 0, 0, markdownTheme, thinkingMessageStyle);

    this.addChild(this.label);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  appendText(text: string): void {
    this.text += text;
    this.body.setText(this.text);
  }

  finish(): void {
    const durationMs = Date.now() - this.startTime;
    const durationS = (durationMs / 1000).toFixed(1);
    this.label.setText(`think for ${durationS}s`);
  }
}
