import { appendFile } from 'node:fs/promises';
import { setLogSink } from './debug-log.js';

/** Node 环境：把 debug log 写入文件。浏览器入口不要 import 本模块。 */
export function configureFileDebugLog(file: string | null): void {
  if (!file) {
    setLogSink(null);
    return;
  }
  setLogSink((chunk) => appendFile(file, chunk).catch(() => {}));
}
