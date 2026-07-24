import { describe, it, expect } from 'vitest';
import { generateId } from '../src/shared/generate-id.js';

describe('generateId', () => {
  it('returns a valid UUID without Node crypto import', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('does not reference node:crypto in module source', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/shared/generate-id.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/from '(node:)?crypto'/);
  });
});
