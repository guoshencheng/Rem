import { describe, it, expect } from 'vitest';
import {
  isInsideCode,
  isInsideCodeAt,
  createCodeRegionScanner,
  closedCodeRegionState,
} from '../../../src/shared/text/code-regions.js';

describe('isInsideCode', () => {
  it('returns true when index falls within a region', () => {
    expect(isInsideCode(2, [{ start: 0, end: 5 }])).toBe(true);
    expect(isInsideCode(0, [{ start: 0, end: 5 }])).toBe(true);
    expect(isInsideCode(4, [{ start: 0, end: 5 }])).toBe(true);
  });

  it('returns false when index is at the end boundary or outside', () => {
    expect(isInsideCode(5, [{ start: 0, end: 5 }])).toBe(false);
    expect(isInsideCode(9, [{ start: 0, end: 5 }])).toBe(false);
    expect(isInsideCode(3, [])).toBe(false);
  });
});

describe('isInsideCodeAt', () => {
  it('detects positions inside a fenced code block', () => {
    const text = '```\n<think>literal</think>\n```';
    const open = text.indexOf('<think>');
    const close = text.indexOf('</think>');
    expect(isInsideCodeAt(text, open)).toBe(true);
    expect(isInsideCodeAt(text, close)).toBe(true);
  });

  it('detects positions outside any code block', () => {
    const text = 'Before <think>x</think> after';
    const open = text.indexOf('<think>');
    const close = text.indexOf('</think>');
    expect(isInsideCodeAt(text, open)).toBe(false);
    expect(isInsideCodeAt(text, close)).toBe(false);
  });

  it('detects positions inside inline code spans', () => {
    const text = 'Use `<think>` for reasoning.';
    const open = text.indexOf('<think>');
    const close = text.indexOf('</think>') >= 0 ? text.indexOf('</think>') : text.indexOf('>');
    // The `<think>` literal sits inside the backtick span.
    expect(isInsideCodeAt(text, open)).toBe(true);
    expect(isInsideCodeAt(text, close)).toBe(true);
  });

  it('does not jump past the queried index (exact stop)', () => {
    // A fence opens at index 4; querying index 0..3 must NOT be reported as inside.
    const text = 'ab\n```\ninside';
    expect(isInsideCodeAt(text, 0)).toBe(false);
    expect(isInsideCodeAt(text, 1)).toBe(false);
    expect(isInsideCodeAt(text, 2)).toBe(false);
    expect(isInsideCodeAt(text, 3)).toBe(false);
    // Inside the fence:
    expect(isInsideCodeAt(text, 8)).toBe(true);
  });
});

describe('createCodeRegionScanner scanToExact', () => {
  it('stops exactly at the requested index without over-scanning', () => {
    const text = '```\n<x>\n```';
    const scanner = createCodeRegionScanner();
    scanner.scanToExact(text, 3); // stop right after the opening fence marker
    const state = scanner.getState();
    // Fence is open at index 3 (the '\n' just after the marker).
    expect(state.fenceOpen).toBe(true);

    // A second scan continuing from this state up to the close marker:
    const scanner2 = createCodeRegionScanner(state);
    scanner2.scanToExact(text.slice(3), 6); // "\n<x>\n`"
    // Still inside the fence because the closing ``` has not fully arrived.
    const state2 = scanner2.getState();
    expect(state2.fenceOpen).toBe(true);
  });
});

describe('closedCodeRegionState', () => {
  it('is a neutral starting state', () => {
    expect(closedCodeRegionState.inlineOpen).toBe(false);
    expect(closedCodeRegionState.fenceOpen).toBe(false);
    expect(closedCodeRegionState.inlineTicks).toBe(0);
    expect(closedCodeRegionState.fenceMarker).toBe('');
  });
});
