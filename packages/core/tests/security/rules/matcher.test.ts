import { describe, it, expect } from 'vitest';
import { matchPattern } from '../../../src/security/rules/matcher.js';

describe('matchPattern', () => {
  it('matches literal strings', () => {
    expect(matchPattern('git status', 'git status')).toBe(true);
    expect(matchPattern('git status', 'git log')).toBe(false);
  });

  it('matches single wildcard segment', () => {
    expect(matchPattern('git status', 'git *')).toBe(true);
    expect(matchPattern('git status --short', 'git *')).toBe(true);
    expect(matchPattern('rm -rf /', 'git *')).toBe(false);
  });

  it('matches double wildcard paths', () => {
    expect(matchPattern('src/foo/bar.ts', 'src/**/*.ts')).toBe(true);
    expect(matchPattern('src/foo.ts', 'src/**/*.ts')).toBe(true);
    expect(matchPattern('test/foo.ts', 'src/**/*.ts')).toBe(false);
  });

  it('matches single character wildcard', () => {
    expect(matchPattern('foo.ts', 'f?o.ts')).toBe(true);
    expect(matchPattern('fao.ts', 'f?o.ts')).toBe(true);
    expect(matchPattern('foo.ts', 'f??o.ts')).toBe(false);
  });
});
