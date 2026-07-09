import fs from 'node:fs/promises';
import path from 'node:path';
import type { Workspace, WorkspaceRepository } from './workspace-repository.js';

interface PersistedWorkspace {
  path: string;
  createdAt: number;
}

interface PersistedData {
  workspaces: PersistedWorkspace[];
}

export class JsonWorkspaceRepository implements WorkspaceRepository {
  constructor(private filePath: string) {}

  async list(): Promise<Workspace[]> {
    const data = await this.read();
    return data.workspaces
      .map((w) => ({ path: w.path, createdAt: w.createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt);
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

    const data = await this.read();
    if (data.workspaces.some((w) => w.path === absolutePath)) {
      throw new Error(`Workspace already exists: ${absolutePath}`);
    }

    const workspace: PersistedWorkspace = {
      path: absolutePath,
      createdAt: Date.now(),
    };
    data.workspaces.push(workspace);
    await this.write(data);
    return { path: workspace.path, createdAt: workspace.createdAt };
  }

  async remove(rawPath: string): Promise<void> {
    const absolutePath = path.resolve(rawPath);
    const data = await this.read();
    const index = data.workspaces.findIndex((w) => w.path === absolutePath);
    if (index === -1) {
      throw new Error(`Workspace not found: ${absolutePath}`);
    }
    data.workspaces.splice(index, 1);
    await this.write(data);
  }

  private async read(): Promise<PersistedData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedData>;
      return { workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [] };
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return { workspaces: [] };
      }
      throw err;
    }
  }

  private async write(data: PersistedData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, this.filePath);
  }
}
