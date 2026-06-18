export interface ToolFormatter {
  formatCall(toolName: string, input: unknown): string;
  formatResultSummary(toolName: string, input: unknown, output: string, error?: string): string;
  formatResultBody(toolName: string, input: unknown, output: string, error?: string): string;
}

function inputField(input: unknown, key: string): string {
  if (!input || typeof input !== "object") return "";
  return String((input as Record<string, unknown>)[key] ?? "");
}

function countLines(text: string): number {
  return text.split("\n").filter(Boolean).length;
}

function extractByteCount(output: string): number | undefined {
  const m = output.match(/(\d+)\s*bytes/);
  return m ? parseInt(m[1], 10) : undefined;
}

function extractEditCount(edits?: unknown): number {
  if (Array.isArray(edits)) return edits.length;
  return 0;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const defaultFormatter: ToolFormatter = {
  formatCall(toolName, input) {
    const compact = truncate(JSON.stringify(input ?? {}), 60);
    return `${toolName}(${compact})`;
  },
  formatResultSummary(toolName, _input, output, error) {
    if (error) return `${toolName}: ${truncate(error, 80)}`;
    return `${toolName}: ${truncate(output.split("\n")[0] ?? "", 80)}`;
  },
  formatResultBody(_toolName, input, output, error) {
    const parts: string[] = [];
    if (input !== undefined) {
      parts.push(`**Input**\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``);
    }
    if (error) {
      parts.push(`**Error**\n\`\`\`\n${error}\n\`\`\``);
    } else if (output) {
      parts.push(`**Output**\n\`\`\`\n${output}\n\`\`\``);
    }
    return parts.join("\n\n");
  },
};

const readFormatter: ToolFormatter = {
  formatCall(_toolName, input) {
    const path = inputField(input, "path") || "…";
    const offset = (input as Record<string, unknown> | null)?.offset;
    const limit = (input as Record<string, unknown> | null)?.limit;
    let call = `Read(${path})`;
    if (offset !== undefined) {
      call += ` @L${offset}`;
      if (limit !== undefined) call += `+${limit}`;
    }
    return call;
  },
  formatResultSummary(_toolName, _input, output, error) {
    if (error) return `Read: ${truncate(error, 80)}`;
    const lines = countLines(output);
    if (lines > 0) return `Read ${lines} lines`;
    const bytes = extractByteCount(output);
    if (bytes) return `Read ${bytes} bytes`;
    return `Read done`;
  },
  formatResultBody(_toolName, _input, output, error) {
    if (error) return `**Error**\n\`\`\`\n${error}\n\`\`\``;
    const ext = (inputField(_input, "path") ?? "").split(".").pop() ?? "";
    return `**Content** (\`${ext}\`)\n\`\`\`${ext}\n${output}\n\`\`\``;
  },
};

const writeFormatter: ToolFormatter = {
  formatCall(_toolName, input) {
    const path = inputField(input, "path") || "…";
    return `Write(${path})`;
  },
  formatResultSummary(_toolName, _input, output, error) {
    if (error) return `Write: ${truncate(error, 80)}`;
    if (output.includes("already up to date")) return `Write: already up to date`;
    const bytes = extractByteCount(output);
    if (bytes) return `Wrote ${bytes} bytes`;
    return `Write done`;
  },
  formatResultBody(_toolName, input, output, error) {
    if (error) return `**Error**\n\`\`\`\n${error}\n\`\`\``;
    const content = inputField(input, "content");
    const parts: string[] = [];
    if (content) {
      const ext = (inputField(input, "path") ?? "").split(".").pop() ?? "";
      parts.push(`**Content** (\`${ext}\`)\n\`\`\`${ext}\n${content}\n\`\`\``);
    }
    parts.push(output);
    return parts.join("\n\n");
  },
};

const editFormatter: ToolFormatter = {
  formatCall(_toolName, input) {
    const path = inputField(input, "path") || "…";
    const edits = (input as Record<string, unknown> | null)?.edits;
    const n = extractEditCount(edits);
    return n > 0 ? `Edit(${path}) [${n} edit${n > 1 ? "s" : ""}]` : `Edit(${path})`;
  },
  formatResultSummary(_toolName, _input, output, error) {
    if (error) return `Edit: ${truncate(error, 80)}`;
    return truncate(output, 80);
  },
  formatResultBody(_toolName, _input, output, error) {
    if (error) return `**Error**\n\`\`\`\n${error}\n\`\`\``;
    return output;
  },
};

const lsFormatter: ToolFormatter = {
  formatCall(_toolName, input) {
    const path = inputField(input, "path") || ".";
    return `ls(${path})`;
  },
  formatResultSummary(_toolName, _input, output, error) {
    if (error) return `ls: ${truncate(error, 80)}`;
    const lines = countLines(output);
    if (lines > 0) return `${lines} entries`;
    return `empty`;
  },
  formatResultBody(_toolName, _input, output, error) {
    if (error) return `**Error**\n\`\`\`\n${error}\n\`\`\``;
    return `\`\`\`\n${output}\n\`\`\``;
  },
};

const formatters = new Map<string, ToolFormatter>([
  ["read", readFormatter],
  ["write", writeFormatter],
  ["edit", editFormatter],
  ["ls", lsFormatter],
]);

export function getToolFormatter(toolName: string): ToolFormatter {
  return formatters.get(toolName) ?? defaultFormatter;
}
