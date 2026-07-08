import { appendFile } from 'fs/promises';

let debugFile: string | null = null;
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const FLUSH_INTERVAL_MS = 100;
const MAX_BUFFER_SIZE = 1000;

/**
 * 配置调试日志输出文件。传入 null 禁用。
 * 应在应用初始化时调用，替代原来的环境变量读取。
 */
export function configureDebugLog(file: string | null): void {
  debugFile = file;
  if (!debugFile) {
    buffer = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

async function flushBuffer(): Promise<void> {
  if (flushing || !debugFile || buffer.length === 0) return;
  flushing = true;
  const lines = buffer.splice(0, buffer.length).join('');
  try {
    await appendFile(debugFile, lines);
  } catch {
    // silently ignore write failures
  } finally {
    flushing = false;
    if (buffer.length > 0 && !flushTimer) {
      scheduleFlush();
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer || !debugFile) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBuffer();
  }, FLUSH_INTERVAL_MS);
}

export function debugLog(tag: string, message: string): void {
  if (!debugFile) return;
  buffer.push(`[${timestamp()}] [${tag}] ${message}\n`);
  if (buffer.length >= MAX_BUFFER_SIZE) {
    void flushBuffer();
  } else {
    scheduleFlush();
  }
}

/**
 * Flush pending debug logs asynchronously.
 * Useful before process exit or tests that need deterministic logs.
 */
export async function flushDebugLog(): Promise<void> {
  await flushBuffer();
}

/**
 * Check whether debug logging is currently enabled.
 */
export function isDebugEnabled(): boolean {
  return debugFile !== null;
}
