import { describe, it, expect } from 'vitest';
import type { ProviderKind } from '../../src/sdk/provider-loader.js';

describe('ProviderKind', () => {
  it('includes new provider kinds', () => {
    const kinds: ProviderKind[] = ['reason', 'execute', 'context', 'loopStrategy'];
    expect(kinds).toContain('reason');
    expect(kinds).toContain('execute');
    expect(kinds).toContain('context');
    expect(kinds).toContain('loopStrategy');
  });
});
