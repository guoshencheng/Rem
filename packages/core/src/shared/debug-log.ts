import { appendFileSync } from 'fs';

let debugFile: string | null | undefined;

function resolveDebugFile(): string | null {
  if (debugFile !== undefined) return debugFile;

  if (process.env.REM_AGENT_DEBUG_FILE) {
    debugFile = process.env.REM_AGENT_DEBUG_FILE;
  } else if (process.env.REM_AGENT_DEBUG === '1') {
    debugFile = '/tmp/rem-agent-debug.log';
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
