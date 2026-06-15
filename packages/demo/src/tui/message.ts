import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { markdownTheme, userMessageStyle, assistantMessageStyle } from "../theme.js";

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

export class AssistantMessage extends Container {
  private body: Markdown;

  constructor(text: string) {
    super();
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}
