import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { ProviderManager } from 'rem-agent-core';
import { createApp } from './app.js';

export interface AgentServerOptions {
  configPath?: string;
  port?: number;
  host?: string;
}

export class AgentServer {
  private app = createApp();
  private server?: ServerType;
  private port: number;
  private host: string;
  private configPath?: string;

  constructor(options: AgentServerOptions = {}) {
    this.port = options.port ?? 8321;
    this.host = options.host ?? 'localhost';
    this.configPath = options.configPath;
  }

  async start(): Promise<void> {
    await ProviderManager.getInstance({ configPath: this.configPath });

    this.server = serve({
      fetch: this.app.fetch,
      port: this.port,
      hostname: this.host,
    });

    console.log(
      `Agent server listening on http://${this.host}:${this.port}`,
    );
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.close(() => resolve());
    });
  }
}
