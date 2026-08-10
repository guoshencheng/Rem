import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const structureScript = fileURLToPath(new URL('../scripts/check-structure.mjs', import.meta.url));

function runStructureCheck(files: Record<string, string>): { status: number; output: string } {
  const srcRoot = mkdtempSync(join(tmpdir(), 'rem-check-structure-'));

  try {
    for (const [path, content] of Object.entries(files)) {
      const file = join(srcRoot, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }

    try {
      const output = execFileSync(process.execPath, [structureScript, `--src-root=${srcRoot}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output };
    } catch (error: unknown) {
      const result = error as { status: number; stderr: string };
      return { status: result.status, output: result.stderr };
    }
  } finally {
    rmSync(srcRoot, { recursive: true, force: true });
  }
}

const rootIndex = { 'index.ts': 'export const value = 1;\n' };

describe('check-structure', () => {
  it('拒绝 domain 导入 Core 根入口', () => {
    const result = runStructureCheck({
      ...rootIndex,
      'domain/boundary.ts': "import { value } from '../index.js';\nexport { value };\n",
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('禁止 domain → (root)');
  });

  it('拒绝 sdk 导入 Core 根入口', () => {
    const result = runStructureCheck({
      ...rootIndex,
      'sdk/boundary.ts': "import { value } from '../index.js';\nexport { value };\n",
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('禁止 sdk → (root)');
  });

  it('允许领域文件使用第三方纯类型', () => {
    const result = runStructureCheck({
      'domain/external-type.ts': "import type { Message } from '@earendil-works/pi-ai';\nexport type TestMessage = Message;\n",
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain('结构检查通过');
  });
});
