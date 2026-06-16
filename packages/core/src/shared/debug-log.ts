import { appendFileSync } from 'fs';

let debugFile: string | null | undefined;

function resolveDebugFile(): string | null {
  if (debugFile !== undefined) return debugFile;

  if (process.env.AGENT_HARNESS_DEBUG_FILE) {
    debugFile = process.env.AGENT_HARNESS_DEBUG_FILE;
  } else if (process.env.AGENT_HARNESS_DEBUG === '1') {
    debugFile = '/tmp/agent-harness-debug.log';
  } else {
    debugFile = null;
  }

  return debugFile;
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

export function debugLog(tag: string, message: string): void {
  const file = resolveDebugFile();
  if (!file) return;
  const line = `[${timestamp()}] [${tag}] ${message}\n`;
  try {
    appendFileSync(file, line);
  } catch {
    // silently ignore write failures
  }
}

/**
 * Check whether debug logging is currently enabled.
 */
export function isDebugEnabled(): boolean {
  return resolveDebugFile() !== null;
}
