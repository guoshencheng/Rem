import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpServerConfig, McpConnectionState } from './types.js';
import { McpClient } from './client.js';
import { McpToolProvider } from './tool-provider.js';
import { log } from '../shared/debug-log.js';

export class McpConnectionManager {
  private states = new Map<string, McpConnectionState>();
  private providers: McpToolProvider[] = [];

  async connectAll(configs: Record<string, McpServerConfig>): Promise<McpToolProvider[]> {
    this.providers = [];

    for (const [name, config] of Object.entries(configs)) {
      if ((config as { disabled?: boolean }).disabled) {
        continue;
      }

      this.states.set(name, { status: 'connecting' });

      try {
        const prefix = (config as { prefix?: string }).prefix ?? name;
        const client = this.createClient(name, config);
        await client.connect();

        const provider = new McpToolProvider(client, { name, prefix });
        await provider.loadTools();

        this.providers.push(provider);
        this.states.set(name, { status: 'connected' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log('mcp', 'failed to connect server', { name, error: message });
        this.states.set(name, { status: 'error', error: message });
      }
    }

    return this.providers;
  }

  getState(name: string): McpConnectionState | undefined {
    return this.states.get(name);
  }

  getAllStates(): Map<string, McpConnectionState> {
    return new Map(this.states);
  }

  getProviders(): McpToolProvider[] {
    return [...this.providers];
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.providers.map((provider) => provider.close().catch(() => {})));
  }

  private createClient(name: string, config: McpServerConfig): McpClient {
    const sdkClient = new Client({ name: `rem-agent-${name}`, version: '0.1.0' });

    if (config.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
      return new McpClient(sdkClient, transport, name);
    }

    const url = new URL(config.url);
    const transport = new SSEClientTransport(url);
    return new McpClient(sdkClient, transport, name);
  }
}
