import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonWorkspaceRepository } from '../src/workspace-repository-json.js';

describe('JsonWorkspaceRepository', () => {
  let tmpDir: string;
  let repo: JsonWorkspaceRepository;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-repo-'));
    repo = new JsonWorkspaceRepository(path.join(tmpDir, 'workspaces.json'));
  });

  it('lists empty workspaces initially', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('adds a workspace and returns it', async () => {
    const ws = await repo.add(tmpDir);
    expect(ws.path).toBe(tmpDir);
    expect(ws.createdAt).toBeTypeOf('number');

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe(tmpDir);
  });

  it('rejects non-existent paths', async () => {
    await expect(repo.add('/definitely/not/existing')).rejects.toThrow('does not exist');
  });

  it('rejects duplicate paths', async () => {
    await repo.add(tmpDir);
    await expect(repo.add(tmpDir)).rejects.toThrow('already exists');
  });

  it('removes a workspace', async () => {
    await repo.add(tmpDir);
    await repo.remove(tmpDir);
    expect(await repo.list()).toEqual([]);
  });

  it('rejects removing non-existent workspace', async () => {
    await expect(repo.remove('/definitely/not/existing')).rejects.toThrow('not found');
  });

  it('normalizes relative paths to absolute', async () => {
    const ws = await repo.add('.');
    expect(path.isAbsolute(ws.path)).toBe(true);
  });
});
