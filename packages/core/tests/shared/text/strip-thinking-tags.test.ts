import { describe, it, expect } from 'vitest';
import { stripThinkingTags } from '../../../src/shared/text/strip-thinking-tags.js';

describe('stripThinkingTags', () => {
  it('returns unchanged text when no thinking tags present', () => {
    expect(stripThinkingTags('Hello, world!')).toBe('Hello, world!');
  });

  it('strips think tags', () => {
    expect(stripThinkingTags('Hello <think>internal reasoning</think>world')).toBe('Hello world');
  });

  it('strips thinking tags', () => {
    expect(stripThinkingTags('Before <thinking>some thought</thinking> after')).toBe('Before after');
  });

  it('strips thought tags', () => {
    expect(stripThinkingTags('A <thought>hmm</thought> B')).toBe('A B');
  });

  it('strips multiple reasoning blocks', () => {
    expect(stripThinkingTags('<think>first</think>A<think>second</think>B')).toBe('A B');
  });

  it('is case-insensitive', () => {
    expect(stripThinkingTags('A <THINK>hidden</THINK> <Thinking>also hidden</Thinking> B')).toBe('A B');
  });

  it('handles attributes on tags', () => {
    expect(stripThinkingTags('A <think id="test" class="foo">hidden</think> B')).toBe('A B');
  });

  it('handles malformed orphan close tag', () => {
    expect(stripThinkingTags('Internal reasoning </think> final answer')).toBe('final answer');
  });

  it('handles unclosed opening tag by stripping to end', () => {
    expect(stripThinkingTags('Before <think>unclosed content after')).toBe('Before');
  });

  it('preserves think tags inside fenced code blocks', () => {
    const input = 'Use the tag like this:\n```\n<think>reasoning</think>\n```\nThat is it!';
    expect(stripThinkingTags(input)).toBe(input);
  });

  it('preserves inline code literals', () => {
    const input = 'The `<think>` tag is used for reasoning.';
    expect(stripThinkingTags(input)).toBe(input);
  });

  it('strips real tags while preserving literal inline examples', () => {
    expect(stripThinkingTags('<think>hidden</think>Visible text with `<think>` example.')).toBe(
      'Visible text with `<think>` example.',
    );
  });

  it('preserves empty string', () => {
    expect(stripThinkingTags('')).toBe('');
  });
});
