import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  configureDebugLog,
  configureConsoleOutput,
  debugLog,
  flushDebugLog,
  isDebugEnabled,
} from '../../src/shared/debug-log.js';

describe('debugLog async batching', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'debug-log-test-'));
    file = join(dir, 'debug.log');
  });

  afterEach(async () => {
    configureDebugLog(null);
    configureConsoleOutput(false);
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes nothing synchronously; flushes asynchronously', async () => {
    configureDebugLog(file);

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
    configureDebugLog(null);
    expect(isDebugEnabled()).toBe(false);
    // Calling debugLog with no file configured is a no-op (no throw).
    expect(() => debugLog('tag', 'msg')).not.toThrow();
  });

  it('isDisabled returns true after configuring a file', () => {
    configureDebugLog(file);
    expect(isDebugEnabled()).toBe(true);
  });

  it('configureDebugLog(null) cancels pending timers', async () => {
    configureDebugLog(file);
    debugLog('tag', 'buffered-but-cleared');
    configureDebugLog(null);

    await flushDebugLog();
    await expect(readFile(file, 'utf-8')).rejects.toThrow();
  });

  it('writes to console when console output is enabled', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    configureDebugLog(file);
    configureConsoleOutput(true);

    debugLog('tag', 'console message');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[tag]'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('console message'));
    consoleSpy.mockRestore();
  });
});
