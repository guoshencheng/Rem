import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { markdownTheme, assistantMessageStyle } from "../theme.js";

export class ToolCallBlock extends Container {
  private body: Markdown;

  constructor(toolName: string, input: unknown) {
    super();
    const text = `${toolName}(${JSON.stringify(input)})`;
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Text("tool call", 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  update(toolName: string, input: unknown): void {
    const text = `${toolName}(${JSON.stringify(input)})`;
    this.body.setText(text);
  }
}
