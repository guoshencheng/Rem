import { describe, it, expect } from 'vitest';
import { parsePatchText } from '../src/plugins/tool/file-system/apply-patch-parser.js';

describe('apply-patch parser', () => {
  it('parses add file', () => {
    const ops = parsePatchText(`*** Begin Patch\n*** Add File: src/foo.ts\n@@\n+ hello\n*** End File\n*** End Patch`);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'add', path: 'src/foo.ts' });
    expect(ops[0]?.hunks[0]?.newLines).toEqual(['hello']);
  });

  it('parses update file', () => {
    const ops = parsePatchText(`*** Begin Patch\n*** Update File: src/foo.ts\n@@ old\n- old\n+ new\n*** End File\n*** End Patch`);
    expect(ops[0]).toMatchObject({ type: 'update', path: 'src/foo.ts' });
    expect(ops[0]?.hunks[0]?.oldLines).toEqual(['old']);
    expect(ops[0]?.hunks[0]?.newLines).toEqual(['new']);
  });

  it('parses delete file', () => {
    const ops = parsePatchText(`*** Begin Patch\n*** Delete File: src/foo.ts\n*** End File\n*** End Patch`);
    expect(ops[0]).toMatchObject({ type: 'delete', path: 'src/foo.ts' });
  });

  it('parses move', () => {
    const ops = parsePatchText(`*** Begin Patch\n*** Update File: src/foo.ts\n@@\n*** Move to: src/bar.ts\n*** End File\n*** End Patch`);
    expect(ops[0]).toMatchObject({ type: 'update', path: 'src/foo.ts', newPath: 'src/bar.ts' });
  });

  it('rejects unrecognized directives', () => {
    expect(() => parsePatchText('*** Weird\n')).toThrow('unrecognized patch directive');
  });
});
