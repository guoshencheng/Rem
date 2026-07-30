import { describe, it, expect } from 'vitest';
import { resolveToCwd, resolveReadPath, resolveWorkspacePath, assertWithinWorkspaceRoot, WorkspaceOutsideError } from '../src/security/workspace-root-guard.js';

describe('workspace-root-guard', () => {
  it('resolves relative paths against cwd', () => {
    expect(resolveToCwd('foo.txt', '/workspace')).toBe('/workspace/foo.txt');
  });

  it('keeps absolute paths', () => {
    expect(resolveToCwd('/workspace/foo.txt', '/other')).toBe('/workspace/foo.txt');
  });

  it('expands ~ to home directory', () => {
    const resolved = resolveToCwd('~/foo.txt', '/workspace');
    expect(resolved).not.toContain('~');
  });

  it('resolves read path with macOS variants fallback', () => {
    expect(resolveReadPath('foo.txt', '/workspace')).toBe('/workspace/foo.txt');
  });

  it('allows paths inside workspace root', () => {
    expect(() => assertWithinWorkspaceRoot('/workspace/foo.txt', '/workspace')).not.toThrow();
  });

  it('rejects paths outside workspace root', () => {
    expect(() => assertWithinWorkspaceRoot('/outside/foo.txt', '/workspace')).toThrow(
      'resolves outside workspace root',
    );
  });

  it('resolves workspace path for valid input', () => {
    const result = resolveWorkspacePath('foo.txt', { cwd: '/workspace', workspaceRoot: '/workspace' });
    expect(result).toBe('/workspace/foo.txt');
  });

  it('rejects workspace path outside root', () => {
    expect(() =>
      resolveWorkspacePath('/outside/foo.txt', { cwd: '/workspace', workspaceRoot: '/workspace' }),
    ).toThrow('resolves outside workspace root');
  });

  it('throws WorkspaceOutsideError when path is outside workspace', () => {
    expect(() =>
      resolveWorkspacePath('/outside/path', { cwd: '/workspace', workspaceRoot: '/workspace' }),
    ).toThrow(WorkspaceOutsideError);
  });

  it('returns path when outsideAllowed is true', () => {
    const result = resolveWorkspacePath(
      '/outside/path',
      { cwd: '/workspace', workspaceRoot: '/workspace' },
      true,
    );
    expect(result).toBe('/outside/path');
  });

  it('includes path and workspace root in WorkspaceOutsideError', () => {
    try {
      resolveWorkspacePath('/outside/path', { cwd: '/workspace', workspaceRoot: '/workspace' });
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceOutsideError);
      expect((err as WorkspaceOutsideError).absolutePath).toBe('/outside/path');
      expect((err as WorkspaceOutsideError).workspaceRoot).toBe('/workspace');
    }
  });
});
