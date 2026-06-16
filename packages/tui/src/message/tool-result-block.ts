import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { markdownTheme, assistantMessageStyle } from "../theme.js";

export class ToolResultBlock extends Container {
  private body: Markdown;

  constructor(output: string, error?: string) {
    super();
    const text = error ? `error: ${error}` : `result: ${output}`;
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Text("tool result", 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  update(output: string, error?: string): void {
    const text = error ? `error: ${error}` : `result: ${output}`;
    this.body.setText(text);
  }
}
