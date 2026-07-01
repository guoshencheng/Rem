import { describe, it, expect } from 'vitest';
import { getMetaString, getMetaBoolean } from '../src/plugins/session/metadata.js';

describe('session metadata helpers', () => {
  it('returns string value', () => {
    expect(getMetaString({ title: 'hello' }, 'title')).toBe('hello');
  });

  it('returns undefined for non-string value', () => {
    expect(getMetaString({ title: 42 }, 'title')).toBeUndefined();
  });

  it('returns boolean value including false', () => {
    expect(getMetaBoolean({ pinned: false }, 'pinned')).toBe(false);
    expect(getMetaBoolean({ pinned: true }, 'pinned')).toBe(true);
  });

  it('returns undefined for non-boolean value', () => {
    expect(getMetaBoolean({ pinned: 'yes' }, 'pinned')).toBeUndefined();
  });
});
