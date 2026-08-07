import { accessSync, constants, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  expandPath,
  resolveReadPath,
  resolveToCwd,
  resolveWorkspacePath,
  assertWithinWorkspaceRoot,
  WorkspaceOutsideError,
} from '../src/security/workspace/workspace-root-guard.js';

const NARROW_NO_BREAK_SPACE = '\u202F';
const CURLY_QUOTE = '\u2019';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rem-security-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('WorkspaceOutsideError', () => {
  it('携带路径与根目录信息', () => {
    const err = new WorkspaceOutsideError('/etc/passwd', '/home/user/project');
    expect(err.name).toBe('WorkspaceOutsideError');
    expect(err.absolutePath).toBe('/etc/passwd');
    expect(err.workspaceRoot).toBe('/home/user/project');
    expect(err.message).toContain('/etc/passwd');
    expect(err.message).toContain('/home/user/project');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('expandPath', () => {
  it('原样返回普通路径', () => {
    expect(expandPath('src/index.ts')).toBe('src/index.ts');
    expect(expandPath('/abs/path')).toBe('/abs/path');
  });

  it('将 Unicode 空格替换为普通空格并 trim', () => {
    expect(expandPath(`a${NARROW_NO_BREAK_SPACE}b.txt`)).toBe('a b.txt');
    expect(expandPath('  padded.txt  ')).toBe('padded.txt');
  });

  it('解析合法的 file:// URL', () => {
    expect(expandPath('file:///tmp/foo.txt')).toBe('/tmp/foo.txt');
  });

  it('非法 file:// URL 回退为归一化后的原字符串', () => {
    expect(expandPath('file://%zz')).toBe('file://%zz');
  });

  it('展开 ~ 与 ~/ 前缀', () => {
    expect(expandPath('~')).toBe(homedir());
    expect(expandPath('~/docs')).toBe(`${homedir()}/docs`);
  });
});

describe('resolveToCwd', () => {
  it('绝对路径原样返回', () => {
    expect(resolveToCwd('/abs/x.txt', '/any/cwd')).toBe('/abs/x.txt');
  });

  it('相对路径基于 cwd 解析', () => {
    expect(resolveToCwd('a/b.txt', '/root')).toBe('/root/a/b.txt');
  });

  it('先经过 expandPath 再解析', () => {
    expect(resolveToCwd('~/x.txt', '/cwd')).toBe(`${expandPath('~')}/x.txt`);
  });
});

describe('resolveReadPath', () => {
  it('文件存在时直接返回解析路径', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'plain.txt'), 'x');
    expect(resolveReadPath('plain.txt', dir)).toBe(join(dir, 'plain.txt'));
  });

  it('macOS 截图风格的窄不换行空格变体', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, `shot 1${NARROW_NO_BREAK_SPACE}PM.png`), 'x');
    expect(resolveReadPath('shot 1 PM.png', dir)).toBe(
      join(dir, `shot 1${NARROW_NO_BREAK_SPACE}PM.png`),
    );
  });

  it('NFD Unicode 变体', () => {
    const dir = makeTempDir();
    const nfdName = 'café.txt'.normalize('NFD');
    writeFileSync(join(dir, nfdName), 'x');
    // macOS APFS normalizes NFC to NFD; either form resolves to same file
    const result = resolveReadPath('café.txt', dir);
    expect([join(dir, nfdName), join(dir, 'café.txt')]).toContain(result);
  });

  it('弯引号变体', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, `it${CURLY_QUOTE}s.txt`), 'x');
    expect(resolveReadPath("it's.txt", dir)).toBe(join(dir, `it${CURLY_QUOTE}s.txt`));
  });

  it('NFD + 弯引号组合变体', () => {
    const dir = makeTempDir();
    const nfdCurly = `café${CURLY_QUOTE}s.txt`.normalize('NFD');
    writeFileSync(join(dir, nfdCurly), 'x');
    const result = resolveReadPath("café's.txt", dir);
    // 只要能正确找到文件即可（NFC/NFD/引号变体允许）
    expect(() => accessSync(result, constants.F_OK)).not.toThrow();
  });

  it('所有变体都不存在时回退为原始解析路径', () => {
    const dir = makeTempDir();
    expect(resolveReadPath('missing.txt', dir)).toBe(join(dir, 'missing.txt'));
  });
});

describe('assertWithinWorkspaceRoot', () => {
  it('根目录内路径通过', () => {
    const dir = makeTempDir();
    const realDir = realpathSync.native(dir);
    const sub = join(realDir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'f.txt'), 'x');
    expect(() => assertWithinWorkspaceRoot(join(sub, 'f.txt'), realDir)).not.toThrow();
  });

  it('根目录外路径抛出 WorkspaceOutsideError', () => {
    const dir = makeTempDir();
    const realDir = realpathSync.native(dir);
    const outside = makeTempDir();
    const realOutside = realpathSync.native(outside);
    writeFileSync(join(realOutside, 'f.txt'), 'x');
    expect(() => assertWithinWorkspaceRoot(join(realOutside, 'f.txt'), realDir)).toThrow(
      WorkspaceOutsideError,
    );
  });

  it('workspace 内的符号链接指向外部时视为越界', () => {
    const dir = makeTempDir();
    const realDir = realpathSync.native(dir);
    const outside = makeTempDir();
    const realOutside = realpathSync.native(outside);
    writeFileSync(join(realOutside, 'f.txt'), 'x');
    symlinkSync(realOutside, join(realDir, 'link'));
    expect(() => assertWithinWorkspaceRoot(join(realDir, 'link', 'f.txt'), realDir)).toThrow(
      WorkspaceOutsideError,
    );
  });

  it('workspace 外的符号链接指向内部时视为合法', () => {
    const dir = makeTempDir();
    const realDir = realpathSync.native(dir);
    const inner = join(realDir, 'inner');
    mkdirSync(inner);
    writeFileSync(join(inner, 'f.txt'), 'x');
    const outside = makeTempDir();
    symlinkSync(inner, join(outside, 'link'));
    expect(() => assertWithinWorkspaceRoot(join(outside, 'link', 'f.txt'), realDir)).not.toThrow();
  });

  it('不存在的路径按字面路径判断', () => {
    const dir = makeTempDir();
    const realDir = realpathSync.native(dir);
    expect(() => assertWithinWorkspaceRoot(join(realDir, 'not-there', 'f.txt'), realDir)).not.toThrow();
    expect(() => assertWithinWorkspaceRoot('/definitely/outside/f.txt', realDir)).toThrow(
      WorkspaceOutsideError,
    );
  });
});

describe('resolveWorkspacePath', () => {
  it('返回 workspace 内的绝对路径', () => {
    const dir = makeTempDir();
    const real = realpathSync.native(dir);
    expect(resolveWorkspacePath('a.txt', { cwd: dir, workspaceRoot: dir })).toBe(
      join(real, 'a.txt'),
    );
  });

  it('越界时默认抛错', () => {
    const dir = makeTempDir();
    expect(() =>
      resolveWorkspacePath('/etc/passwd', { cwd: dir, workspaceRoot: dir }),
    ).toThrow(WorkspaceOutsideError);
  });

  it('outsideAllowed=true 时允许越界路径', () => {
    const dir = makeTempDir();
    expect(
      resolveWorkspacePath('/etc/passwd', { cwd: dir, workspaceRoot: dir }, true),
    ).toBe('/etc/passwd');
  });

  it('相对路径基于 realpath 后的 cwd 解析', () => {
    const dir = makeTempDir();
    const real = realpathSync.native(dir);
    expect(resolveWorkspacePath('./x/y.txt', { cwd: dir, workspaceRoot: dir })).toBe(
      join(real, 'x/y.txt'),
    );
  });
});
