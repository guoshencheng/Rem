import { appendFile } from 'fs/promises';

let debugFile: string | null = null;
let consoleOutputEnabled = false;
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const FLUSH_INTERVAL_MS = 100;
const MAX_BUFFER_SIZE = 1000;

/** 日志上下文，会自动拼接到消息里 */
export interface LogContext {
  sessionId?: string;
  workspace?: string;
  step?: number;
  messageId?: string;
  chunkType?: string;
  toolName?: string;
  [key: string]: string | number | boolean | undefined;
}

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

/**
 * 是否同时把日志输出到控制台（开发环境实时可见）。
 */
export function configureConsoleOutput(enabled: boolean): void {
  consoleOutputEnabled = enabled;
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

function formatContext(context?: LogContext): string {
  if (!context) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    parts.push(`${key}=${String(value)}`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
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

function writeToConsole(tag: string, message: string, context?: LogContext): void {
  if (!consoleOutputEnabled) return;
  const ctx = formatContext(context);
  // eslint-disable-next-line no-console
  console.log(`[${tag}]${ctx} ${message}`);
}

function writeToFile(line: string): void {
  if (!debugFile) return;
  buffer.push(line);
  if (buffer.length >= MAX_BUFFER_SIZE) {
    void flushBuffer();
  } else {
    scheduleFlush();
  }
}

/**
 * 输出结构化日志。优先使用此函数，便于统一携带上下文。
 */
export function log(tag: string, message: string, context?: LogContext): void {
  const ctx = formatContext(context);
  const fileLine = `[${timestamp()}] [${tag}]${ctx} ${message}\n`;
  writeToFile(fileLine);
  writeToConsole(tag, message, context);
}

/**
 * 原始 debug 日志接口，保持向后兼容。
 */
export function debugLog(tag: string, message: string): void {
  log(tag, message);
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
