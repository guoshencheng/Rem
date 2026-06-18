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
    this.label = new Text("", 0, 0, dim);
    this.body = new Markdown("", 0, 0, markdownTheme, thinkingMessageStyle);

    this.addChild(this.label);
    this.addChild(new Spacer(1));
    this.addChild(this.body);

    this.updateLabel();
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

  loadText(text: string): void {
    this.text = text;
    this.body.setText(text);
    this.finished = true;
    this.durationS = "0.0";
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
    const base = this.finished && this.durationS
      ? `think for ${this.durationS}s`
      : "thinking";
    if (this.collapsed) {
      const preview = this.previewText();
      const previewPart = preview ? `: ${preview}` : "";
      this.label.setText(`${base}${previewPart} > (按 ctrl+o 展开)`);
    } else {
      this.label.setText(base);
    }
  }

  private previewText(): string {
    const clean = this.text.replace(/\s+/g, " ").trim();
    if (!clean) return "";
    return clean.length > 50 ? `${clean.slice(0, 50)}…` : clean;
  }
}
