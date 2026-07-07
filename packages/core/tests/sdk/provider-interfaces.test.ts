import { describe, it, expect } from 'vitest';
import type { LoopStrategy, ReasonProvider, ExecuteProvider, ContextProvider } from '../../src/sdk/index.js';

describe('provider interfaces are exported', () => {
  it('types are importable', () => {
    const _loop: LoopStrategy | undefined = undefined;
    const _reason: ReasonProvider | undefined = undefined;
    const _execute: ExecuteProvider | undefined = undefined;
    const _context: ContextProvider | undefined = undefined;
    expect([_loop, _reason, _execute, _context]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
