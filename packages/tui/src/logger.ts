import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

function getLogPath(): string {
  const envPath = process.env.TUI_LOG_FILE;
  if (envPath) return envPath.replace(/^~/, homedir());
  return join(homedir(), ".rem-agent", "tui.log");
}

let logPath: string | null = null;

export async function appendLog(type: string, message: string): Promise<void> {
  if (!logPath) {
    logPath = getLogPath();
    const dir = logPath.substring(0, logPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true }).catch(() => {});
  }
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${type}: ${message}\n`;
  await appendFile(logPath, line).catch(() => {});
}
