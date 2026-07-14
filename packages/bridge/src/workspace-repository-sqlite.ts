import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceStore } from 'rem-agent-core';
import type { Workspace, WorkspaceRepository } from './workspace-repository.js';

export class SqliteWorkspaceRepository implements WorkspaceRepository {
  constructor(private store: WorkspaceStore) {}

  async list(): Promise<Workspace[]> {
    return this.store.list();
  }

  async add(rawPath: string): Promise<Workspace> {
    const absolutePath = path.resolve(rawPath);
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        throw new Error(`Workspace path is not a directory: ${absolutePath}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Workspace path does not exist or is not readable: ${absolutePath} (${message})`);
    }

    return this.store.add(absolutePath);
  }

  async remove(rawPath: string): Promise<void> {
    const absolutePath = path.resolve(rawPath);
    return this.store.remove(absolutePath);
  }
}
