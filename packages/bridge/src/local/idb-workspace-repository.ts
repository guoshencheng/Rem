import type { WorkspaceStore } from 'rem-agent-core/browser';
import type { Workspace } from '../types.js';
import type { WorkspaceRepository } from '../workspace-repository.js';

export class IdbWorkspaceRepository implements WorkspaceRepository {
  constructor(private store: WorkspaceStore) {}

  async list(): Promise<Workspace[]> {
    const records = await this.store.list();
    return records.map((r) => ({ path: r.path, createdAt: r.createdAt }));
  }

  async add(path: string): Promise<Workspace> {
    const record = await this.store.add(path);
    return { path: record.path, createdAt: record.createdAt };
  }

  async remove(path: string): Promise<void> {
    await this.store.remove(path);
  }
}
