import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderRouteFile, resolveAppDir, parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('使用默认值', () => {
    const opts = parseArgs([]);
    expect(opts.prefix).toBe('api/rem');
    expect(opts.containerPath).toBe('@/lib/container');
    expect(opts.force).toBe(false);
  });

  it('解析各选项', () => {
    const opts = parseArgs(['--root', '/tmp/x', '--prefix', '/api/rem/', '--container-path', '@/di', '--app-dir', 'app', '--force']);
    expect(opts.root).toBe('/tmp/x');
    expect(opts.prefix).toBe('api/rem');
    expect(opts.containerPath).toBe('@/di');
    expect(opts.appDir).toBe('app');
    expect(opts.force).toBe(true);
  });
});

describe('renderRouteFile', () => {
  it('生成薄壳 route.ts，包含 container 路径引用', () => {
    const content = renderRouteFile({ containerPath: '@/lib/container' });
    expect(content).toContain("from 'rem-agent-routes'");
    expect(content).toContain("from '@/lib/container'");
    expect(content).toContain('createRemHandler');
    expect(content).toContain('route as GET');
    expect(content).toContain('route as POST');
    expect(content).toContain('route as PATCH');
    expect(content).toContain('route as DELETE');
  });
});

describe('resolveAppDir', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rem-routes-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('存在 src/app 时优先使用', () => {
    mkdirSync(join(dir, 'src/app'), { recursive: true });
    mkdirSync(join(dir, 'app'), { recursive: true });
    expect(resolveAppDir(dir)).toBe(join('src', 'app'));
  });

  it('只有 app 时使用 app', () => {
    mkdirSync(join(dir, 'app'), { recursive: true });
    expect(resolveAppDir(dir)).toBe('app');
  });

  it('都不存在时默认 src/app', () => {
    expect(resolveAppDir(dir)).toBe(join('src', 'app'));
  });
});

describe('rem-routes init（构建产物端到端）', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rem-routes-e2e-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('生成文件、幂等跳过、--force 覆盖', () => {
    const bin = new URL('../dist/bin.js', import.meta.url).pathname;
    mkdirSync(join(dir, 'src/app'), { recursive: true });

    execFileSync('node', [bin, '--root', dir]);
    const target = join(dir, 'src/app/api/rem/[...path]/route.ts');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('createRemHandler');

    writeFileSync(target, '// modified');
    const out = execFileSync('node', [bin, '--root', dir], { encoding: 'utf8' });
    expect(out).toContain('已存在');
    expect(readFileSync(target, 'utf8')).toBe('// modified');

    execFileSync('node', [bin, '--root', dir, '--force']);
    expect(readFileSync(target, 'utf8')).toContain('createRemHandler');
  });

  it('自定义 prefix 与 app-dir', () => {
    const bin = new URL('../dist/bin.js', import.meta.url).pathname;
    mkdirSync(join(dir, 'app'), { recursive: true });
    execFileSync('node', [bin, '--root', dir, '--prefix', 'api/v2', '--app-dir', 'app']);
    const target = join(dir, 'app/api/v2/[...path]/route.ts');
    expect(existsSync(target)).toBe(true);
  });
});
