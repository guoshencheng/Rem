import fs from 'node:fs/promises';
import path from 'node:path';
import { initRuleEngine } from 'rem-agent-core';
import type { AgentDI, AgentRuntimeConfig } from 'rem-agent-core';
import { AgentServiceCore } from './agent-service-core.js';
import type { IAgentService } from './agent-service.interface.js';
import type { Workspace } from './types.js';

export class AgentService extends AgentServiceCore implements IAgentService {
  constructor(di: AgentDI, runtimeConfig: AgentRuntimeConfig) {
    super(di, runtimeConfig);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await this._di.configProvider.init();
    await this._di.storage.init();
    await initRuleEngine(this._di);
    this._di.mcpProviders = await this._di.mcpManager.connectAll(this._di.configProvider.getMcpConfig());

    this.initialized = true;
  }

  async addWorkspace(rawPath: string): Promise<Workspace> {
    return super.addWorkspace(await this.resolveWorkspaceDir(rawPath));
  }

  async removeWorkspace(rawPath: string): Promise<void> {
    return super.removeWorkspace(path.resolve(rawPath));
  }

  private async resolveWorkspaceDir(rawPath: string): Promise<string> {
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
