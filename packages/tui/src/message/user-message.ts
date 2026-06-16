import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { markdownTheme, userMessageStyle } from "../theme.js";

export class UserMessage extends Container {
  private body: Markdown;

  constructor(text: string) {
    super();
    this.body = new Markdown(text, 1, 0, markdownTheme, userMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}
