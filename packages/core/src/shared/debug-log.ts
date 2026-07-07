import { appendFileSync } from 'fs';

let debugFile: string | null = null;

/**
 * 配置调试日志输出文件。传入 null 禁用。
 * 应在应用初始化时调用，替代原来的环境变量读取。
 */
export function configureDebugLog(file: string | null): void {
  debugFile = file;
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

export function debugLog(tag: string, message: string): void {
  if (!debugFile) return;
  const line = `[${timestamp()}] [${tag}] ${message}\n`;
  try {
    appendFileSync(debugFile, line);
  } catch {
    // silently ignore write failures
  }
}

/**
 * Check whether debug logging is currently enabled.
 */
export function isDebugEnabled(): boolean {
  return debugFile !== null;
}
