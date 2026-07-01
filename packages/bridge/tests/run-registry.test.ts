import { describe, it, expect } from 'vitest';
import { runRegistry } from '../src/run-registry.js';

describe('runRegistry', () => {
  it('registers a new session', () => {
    const controller = new AbortController();
    expect(runRegistry.has('s1')).toBe(false);
    const result = runRegistry.register('s1', controller);
    expect(result).toBe(true);
    expect(runRegistry.has('s1')).toBe(true);
    runRegistry.remove('s1');
  });

  it('rejects duplicate registration', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    runRegistry.register('s2', c1);
    const result = runRegistry.register('s2', c2);
    expect(result).toBe(false);
    expect(runRegistry.has('s2')).toBe(true);
    runRegistry.remove('s2');
  });

  it('aborts and returns true for active session', () => {
    const controller = new AbortController();
    runRegistry.register('s3', controller);
    const aborted = runRegistry.abort('s3');
    expect(aborted).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    runRegistry.remove('s3');
  });

  it('returns false when aborting non-existent session', () => {
    const aborted = runRegistry.abort('nonexistent');
    expect(aborted).toBe(false);
  });

  it('removes a session', () => {
    const controller = new AbortController();
    runRegistry.register('s4', controller);
    runRegistry.remove('s4');
    expect(runRegistry.has('s4')).toBe(false);
  });

  it('is idempotent for remove', () => {
    runRegistry.remove('never-registered');
    expect(runRegistry.has('never-registered')).toBe(false);
  });

  it('abort does not remove the entry', () => {
    const controller = new AbortController();
    runRegistry.register('s5', controller);
    runRegistry.abort('s5');
    expect(runRegistry.has('s5')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    runRegistry.remove('s5');
  });

  it('duplicate register does not overwrite original controller', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    runRegistry.register('s6', c1);
    runRegistry.register('s6', c2);
    const entry = runRegistry.has('s6');
    expect(entry).toBe(true);
    runRegistry.abort('s6');
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(false);
    runRegistry.remove('s6');
  });
});
