import { describe, it, expect } from 'vitest';
import {
  ThinkingTagPartitioner,
  partitionThinkingTags,
} from '../../../../src/shared/text/thinking-tag/index.js';

describe('ThinkingTagPartitioner', () => {
  it('emits plain text when no tags present', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('Hello, world!')).toEqual([{ type: 'text', text: 'Hello, world!' }]);
    expect(partitioner.flush()).toEqual([]);
  });

  it('partitions a complete think tag in one chunk', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('Before <think>reasoning</think> after')).toEqual([
      { type: 'text', text: 'Before ' },
      { type: 'thinking', text: 'reasoning' },
      { type: 'text', text: ' after' },
    ]);
  });

  it('buffers an incomplete tag prefix across chunks', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('Before <thi')).toEqual([{ type: 'text', text: 'Before ' }]);
    expect(partitioner.push('nk>reasoning</think> after')).toEqual([
      { type: 'thinking', text: 'reasoning' },
      { type: 'text', text: ' after' },
    ]);
  });

  it('streams thinking content incrementally across chunks', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('Before <think>rea')).toEqual([
      { type: 'text', text: 'Before ' },
      { type: 'thinking', text: 'rea' },
    ]);
    expect(partitioner.push('soning</think> after')).toEqual([
      { type: 'thinking', text: 'soning' },
      { type: 'text', text: ' after' },
    ]);
  });

  it('splits content across closing tag boundary', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('Before <think>reasoning</th')).toEqual([
      { type: 'text', text: 'Before ' },
      { type: 'thinking', text: 'reasoning' },
    ]);
    expect(partitioner.push('ink> after')).toEqual([
      { type: 'text', text: ' after' },
    ]);
  });

  it('handles nested thinking tags by removing nested markers', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(
      partitioner.push('<think>outer <think>nested</think> still hidden</think> visible'),
    ).toEqual([
      { type: 'thinking', text: 'outer nested still hidden' },
      { type: 'text', text: ' visible' },
    ]);
  });

  it('treats orphan close tag as leaked reasoning when surrounded by text', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('leaked </think> final')).toEqual([
      { type: 'text', text: ' final' },
    ]);
  });

  it('drops orphan close tag at start of content', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('</think> final')).toEqual([
      { type: 'text', text: ' final' },
    ]);
  });

  it('streams unclosed thinking content incrementally', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('Before <think>hidden')).toEqual([
      { type: 'text', text: 'Before ' },
      { type: 'thinking', text: 'hidden' },
    ]);
    expect(partitioner.flush()).toEqual([]);
  });

  it('emits unclosed reasoning content as thinking when no visible text preceded', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('<think>only reasoning')).toEqual([
      { type: 'thinking', text: 'only reasoning' },
    ]);
    expect(partitioner.flush()).toEqual([]);
  });

  it('matches thinking and thought tags case-insensitively', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('A <THINK>x</THINK> <Thinking>y</Thinking> <thought>z</thought> B')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'thinking', text: 'x' },
      { type: 'text', text: ' ' },
      { type: 'thinking', text: 'y' },
      { type: 'text', text: ' ' },
      { type: 'thinking', text: 'z' },
      { type: 'text', text: ' B' },
    ]);
  });

  it('preserves tags inside fenced code blocks', () => {
    const partitioner = new ThinkingTagPartitioner();
    const input = '```\n<think>literal</think>\n```';
    expect(partitioner.push(input)).toEqual([{ type: 'text', text: input }]);
  });

  it('preserves tags inside inline code spans', () => {
    const partitioner = new ThinkingTagPartitioner();
    const input = 'Use `<think>` for reasoning.';
    expect(partitioner.push(input)).toEqual([{ type: 'text', text: input }]);
  });

  it('handles tags with attributes', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('A <think id="r1">hidden</think> B')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'thinking', text: 'hidden' },
      { type: 'text', text: ' B' },
    ]);
  });

  it('handles empty chunks', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('')).toEqual([]);
    expect(partitioner.push('<think>x</think>')).toEqual([{ type: 'thinking', text: 'x' }]);
  });

  it('flushes any buffered text after normal chunks', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('plain text')).toEqual([{ type: 'text', text: 'plain text' }]);
    expect(partitioner.flush()).toEqual([]);
  });

  it('coalesces consecutive deltas of the same type within a chunk', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('<think>a</think><think>b</think>')).toEqual([
      { type: 'thinking', text: 'ab' },
    ]);
  });

  it('handles namespace-prefixed tags like mm:think', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('<mm:think>hidden</mm:think> visible')).toEqual([
      { type: 'thinking', text: 'hidden' },
      { type: 'text', text: ' visible' },
    ]);
  });

  it('streams namespace-prefixed thinking incrementally', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('A <mm:think>rea')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'thinking', text: 'rea' },
    ]);
    expect(partitioner.push('soning</mm:think> B')).toEqual([
      { type: 'thinking', text: 'soning' },
      { type: 'text', text: ' B' },
    ]);
  });

  it('buffers incomplete namespace-prefixed tag', () => {
    const partitioner = new ThinkingTagPartitioner();
    expect(partitioner.push('Before <mm:thi')).toEqual([{ type: 'text', text: 'Before ' }]);
    expect(partitioner.push('nk>hidden</mm:think> after')).toEqual([
      { type: 'thinking', text: 'hidden' },
      { type: 'text', text: ' after' },
    ]);
  });

  it('isolates state between two independent instances', () => {
    const p1 = new ThinkingTagPartitioner();
    const p2 = new ThinkingTagPartitioner();

    expect(p1.push('<think>a')).toEqual([{ type: 'thinking', text: 'a' }]);
    expect(p2.push('hello')).toEqual([{ type: 'text', text: 'hello' }]);

    expect(p1.push('</think> after')).toEqual([{ type: 'text', text: ' after' }]);
    expect(p2.push(' world')).toEqual([{ type: 'text', text: ' world' }]);
  });

  it('flush is idempotent', () => {
    const partitioner = new ThinkingTagPartitioner();
    partitioner.push('hello');
    expect(partitioner.flush()).toEqual([]);
    expect(partitioner.flush()).toEqual([]);
  });

  it('supports push-flush-push-flush lifecycle for reuse', () => {
    const partitioner = new ThinkingTagPartitioner();

    expect(partitioner.push('A <think>hidden</think> B')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'thinking', text: 'hidden' },
      { type: 'text', text: ' B' },
    ]);
    expect(partitioner.flush()).toEqual([]);

    expect(partitioner.push('C <think>x</think> D')).toEqual([
      { type: 'text', text: 'C ' },
      { type: 'thinking', text: 'x' },
      { type: 'text', text: ' D' },
    ]);
    expect(partitioner.flush()).toEqual([]);
  });
});

describe('partitionThinkingTags', () => {
  it('returns all deltas for complete input', () => {
    expect(partitionThinkingTags('A <think>reasoning</think> B')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'thinking', text: 'reasoning' },
      { type: 'text', text: ' B' },
    ]);
  });

  it('handles namespace-prefixed tags in bulk mode', () => {
    expect(partitionThinkingTags('A <mm:think>reasoning</mm:think> B')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'thinking', text: 'reasoning' },
      { type: 'text', text: ' B' },
    ]);
  });
});
