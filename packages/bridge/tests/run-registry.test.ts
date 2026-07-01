import { describe, it, expect } from 'vitest';
import { runRegistry } from '../src/run-registry.js';

describe('runRegistry', () => {
  it('register returns true for new session', () => {
    const controller = new AbortController();
    const result = runRegistry.register('new-session', controller);
    expect(result).toBe(true);
    runRegistry.remove('new-session');
  });

  it('register returns false for duplicate session', () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    runRegistry.register('dup-session', controller1);
    const result = runRegistry.register('dup-session', controller2);
    expect(result).toBe(false);
    runRegistry.remove('dup-session');
  });
});
