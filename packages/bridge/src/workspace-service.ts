import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentDI, ConfigProvider, WorkspaceRecord } from 'rem-agent-core';

export class WorkspaceService {
  constructor(private readonly di: AgentDI) {}

  async list(): Promise<WorkspaceRecord[]> {
    return this.di.storage.workspaceStore.list();
  }

  async add(rawPath: string): Promise<WorkspaceRecord> {
    return this.di.storage.workspaceStore.add(await this.resolveDir(rawPath));
  }

  async remove(rawPath: string): Promise<void> {
    return this.di.storage.workspaceStore.remove(path.resolve(rawPath));
  }

  /** workspace 级配置解析（forWorkspace 收敛到这里） */
  resolveConfig(workspace: string): ConfigProvider {
    return this.di.configProvider.forWorkspace?.(workspace) ?? this.di.configProvider;
  }

  private async resolveDir(rawPath: string): Promise<string> {
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
    return absolutePath;
  }
}
