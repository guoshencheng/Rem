import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { dim, green, red, yellow } from "../colors.js";
import { markdownTheme, toolMessageStyle } from "../theme.js";

export type ToolStatus = "pending" | "running" | "success" | "failed";

function statusIcon(status: ToolStatus): string {
  switch (status) {
    case "pending":
      return "◐";
    case "running":
      return "◐";
    case "success":
      return "✓";
    case "failed":
      return "✗";
  }
}

function statusColor(status: ToolStatus) {
  switch (status) {
    case "pending":
    case "running":
      return yellow;
    case "success":
      return green;
    case "failed":
      return red;
  }
}

function formatInput(input: unknown): string {
  if (input === undefined) return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function formatDuration(startTime: number, endTime: number): string {
  const ms = endTime - startTime;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export class FunctionToolBlock extends Container {
  private label: Text;
  private body: Markdown;
  private collapsed: boolean;
  private status: ToolStatus = "pending";
  private toolName = "";
  private input = "";
  private output = "";
  private error?: string;
  private startTime: number;
  private endTime?: number;

  constructor(toolName: string, input: unknown, collapsed = true) {
    super();
    this.collapsed = collapsed;
    this.startTime = Date.now();
    this.label = new Text("", 0, 0, dim);
    this.body = new Markdown("", 0, 0, markdownTheme, toolMessageStyle);

    this.addChild(this.label);
    this.addChild(new Spacer(1));
    this.addChild(this.body);

    this.update(toolName, input);
  }

  update(toolName: string, input: unknown): void {
    this.toolName = toolName;
    this.input = formatInput(input);
    this.updateLabel();
    this.updateBody();
  }

  setRunning(): void {
    this.status = "running";
    this.updateLabel();
  }

  setResult(output: string, error?: string): void {
    this.status = error ? "failed" : "success";
    this.output = output;
    this.error = error;
    this.endTime = Date.now();
    this.updateLabel();
    this.updateBody();
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
    const icon = statusColor(this.status)(statusIcon(this.status));
    const duration = this.endTime
      ? ` (${formatDuration(this.startTime, this.endTime)})`
      : this.status === "running"
        ? " ..."
        : "";
    const summary = this.formatSummary();
    const expandHint = this.collapsed ? " (按 ctrl+t 展开)" : "";
    this.label.setText(`${icon} ${this.toolName}(${summary})${duration}${expandHint}`);
  }

  private formatSummary(): string {
    if (!this.input) return "";
    const lines = this.input.split("\n");
    if (lines.length <= 1) {
      const compact = this.input.replace(/\s+/g, " ").trim();
      return compact.length > 60 ? `${compact.slice(0, 60)}...` : compact;
    }
    return "{...}";
  }

  private updateBody(): void {
    const parts: string[] = [];
    if (this.input) {
      parts.push(`**Input**\n\`\`\`json\n${this.input}\n\`\`\``);
    }
    if (this.error) {
      parts.push(`**Error**\n\`\`\`\n${this.error}\n\`\`\``);
    } else if (this.output) {
      parts.push(`**Output**\n\`\`\`\n${this.output}\n\`\`\``);
    }
    this.body.setText(parts.join("\n\n"));
  }
}
