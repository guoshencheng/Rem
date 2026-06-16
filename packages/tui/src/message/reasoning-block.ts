import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { dim } from "../colors.js";
import { markdownTheme, thinkingMessageStyle } from "../theme.js";

export class ReasoningBlock extends Container {
  private label: Text;
  private body: Markdown;
  private text = "";
  private startTime: number;
  private collapsed: boolean;
  private finished = false;
  private durationS?: string;

  constructor(collapsed = true) {
    super();
    this.collapsed = collapsed;
    this.startTime = Date.now();
    this.label = new Text("thinking >", 0, 0, dim);
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
    this.finished = true;
    const durationMs = Date.now() - this.startTime;
    this.durationS = (durationMs / 1000).toFixed(1);
    this.updateLabel();
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.updateLabel();
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  render(width: number): string[] {
    if (this.collapsed) {
      return this.label.render(width);
    }
    return super.render(width);
  }

  private updateLabel(): void {
    if (this.finished && this.durationS) {
      this.label.setText(`think for ${this.durationS}s >`);
    } else {
      this.label.setText("thinking >");
    }
  }
}
