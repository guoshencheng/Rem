import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  configureConsoleOutput,
  debugLog,
  flushDebugLog,
  isDebugEnabled,
  log,
  setLogSink,
} from '../../src/shared/debug-log.js';
import { configureFileDebugLog } from '../../src/shared/debug-log-file.js';

describe('debugLog async batching', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'debug-log-test-'));
    file = join(dir, 'debug.log');
  });

  afterEach(async () => {
    configureFileDebugLog(null);
    configureConsoleOutput(false);
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes nothing synchronously; flushes asynchronously', async () => {
    configureFileDebugLog(file);

    debugLog('tag', 'first message');
    debugLog('tag', 'second message');

    // Lines are buffered and not written until the debounce timer fires.
    await expect(readFile(file, 'utf-8')).rejects.toThrow();

    await flushDebugLog();

    const raw = await readFile(file, 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[tag]');
    expect(lines[0]).toContain('first message');
    expect(lines[1]).toContain('[tag]');
    expect(lines[1]).toContain('second message');
  });

  it('isDisabled returns false without a configured file', () => {
    configureFileDebugLog(null);
    expect(isDebugEnabled()).toBe(false);
    // Calling debugLog with no file configured is a no-op (no throw).
    expect(() => debugLog('tag', 'msg')).not.toThrow();
  });

  it('isDisabled returns true after configuring a file', () => {
    configureFileDebugLog(file);
    expect(isDebugEnabled()).toBe(true);
  });

  it('configureFileDebugLog(null) cancels pending timers', async () => {
    configureFileDebugLog(file);
    debugLog('tag', 'buffered-but-cleared');
    configureFileDebugLog(null);

    await flushDebugLog();
    await expect(readFile(file, 'utf-8')).rejects.toThrow();
  });

  it('writes to console when console output is enabled', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    configureFileDebugLog(file);
    configureConsoleOutput(true);

    debugLog('tag', 'console message');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[tag]'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('console message'));
    consoleSpy.mockRestore();
  });
});

describe('debug-log sink (platform neutral)', () => {
  afterEach(() => setLogSink(null));

  it('module source has no static fs import', async () => {
    const src = await readFile(new URL('../../src/shared/debug-log.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/^import .* from '(node:)?fs/m);
  });

  it('writes buffered lines to injected sink', async () => {
    const chunks: string[] = [];
    setLogSink((chunk) => { chunks.push(chunk); });
    expect(isDebugEnabled()).toBe(true);
    log('test', 'hello', { sessionId: 's1' });
    await flushDebugLog();
    expect(chunks.join('')).toContain('[test]');
    expect(chunks.join('')).toContain('hello');
  });

  it('null sink disables logging', () => {
    setLogSink(null);
    expect(isDebugEnabled()).toBe(false);
  });
});
