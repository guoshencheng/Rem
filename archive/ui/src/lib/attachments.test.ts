/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { buildUserInputContent, isTextFile, TEXT_FILE_MAX_BYTES, IMAGE_MAX_BYTES } from './attachments.js';

describe('isTextFile', () => {
  it('accepts text MIME and known extensions', () => {
    expect(isTextFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(true);
    expect(isTextFile(new File(['x'], 'b.ts', { type: '' }))).toBe(true);
    expect(isTextFile(new File(['x'], 'c.png', { type: 'image/png' }))).toBe(false);
    expect(isTextFile(new File(['x'], 'd.bin', { type: 'application/octet-stream' }))).toBe(false);
  });
});

describe('buildUserInputContent', () => {
  it('returns plain string when only text', () => {
    expect(buildUserInputContent('hello', [], [])).toBe('hello');
  });

  it('inlines text files with <file> fences', () => {
    const result = buildUserInputContent('see this', [{ name: 'a.ts', text: 'const x = 1;' }], []);
    expect(result).toBe('<file name="a.ts">\nconst x = 1;\n</file>\n\nsee this');
  });

  it('returns parts array when images present', () => {
    const result = buildUserInputContent('look', [], [{ name: 'p.png', data: 'aGVsbG8=', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' }]);
    expect(result).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);
  });

  it('combines text files and images', () => {
    const result = buildUserInputContent(
      'ctx',
      [{ name: 'a.md', text: '# doc' }],
      [{ name: 'p.png', data: 'aGVsbG8=', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' }],
    );
    expect(result).toEqual([
      { type: 'text', text: '<file name="a.md">\n# doc\n</file>\n\nctx' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);
  });

  it('exports size limits', () => {
    expect(TEXT_FILE_MAX_BYTES).toBe(100 * 1024);
    expect(IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
