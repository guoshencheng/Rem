import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { markdownTheme, assistantMessageStyle } from "../theme.js";

export class AssistantMessage extends Container {
  private body: Markdown;
  private text = "";

  constructor(text: string) {
    super();
    this.text = text;
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
    this.body.setText(text);
  }

  appendText(text: string): void {
    this.text += text;
    this.body.setText(this.text);
  }
}
