import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { dim, green, red, yellow } from "../colors.js";
import { markdownTheme, toolMessageStyle } from "../theme.js";
import { getToolFormatter, type ToolFormatter } from "./tool-formatter.js";

export type ToolStatus = "pending" | "running" | "success" | "failed";

function statusIcon(status: ToolStatus): string {
  switch (status) {
    case "pending":
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
  private rawInput: unknown;
  private output = "";
  private error?: string;
  private startTime: number;
  private endTime?: number;
  private formatter: ToolFormatter;

  constructor(toolName: string, input: unknown, collapsed = true) {
    super();
    this.collapsed = collapsed;
    this.startTime = Date.now();
    this.formatter = getToolFormatter(toolName);
    this.label = new Text("", 0, 0, dim);
    this.body = new Markdown("", 0, 0, markdownTheme, toolMessageStyle);

    this.addChild(this.label);
    this.addChild(new Spacer(1));
    this.addChild(this.body);

    this.update(toolName, input);
  }

  update(toolName: string, input: unknown): void {
    this.toolName = toolName;
    this.rawInput = input;
    this.formatter = getToolFormatter(toolName);
    this.updateLabel();
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
    const call = this.formatter.formatCall(this.toolName, this.rawInput);

    if (this.status === "pending" || this.status === "running") {
      const dots = " ...";
      const hint = this.collapsed ? " (ctrl+o 展开)" : "";
      this.label.setText(`${icon} ${call}${dots}${hint}`);
      return;
    }

    const summary = this.formatter.formatResultSummary(
      this.toolName, this.rawInput, this.output, this.error,
    );
    const duration = this.endTime ? ` (${formatDuration(this.startTime, this.endTime)})` : "";

    if (this.collapsed) {
      this.label.setText(`${icon} ${call}  ${summary}  (ctrl+o 展开)`);
    } else {
      this.label.setText(`${icon} ${call}${duration}`);
    }
  }

  private updateBody(): void {
    const content = this.formatter.formatResultBody(
      this.toolName, this.rawInput, this.output, this.error,
    );
    this.body.setText(content);
  }
}
