import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpToolInfo } from './types.js';

export class McpClient {
  private client: Client;
  private transport: Transport;
  private serverName: string;
  private connected = false;

  constructor(client: Client, transport: Transport, serverName: string) {
    this.client = client;
    this.transport = transport;
    this.serverName = serverName;
  }

  getName(): string {
    return this.serverName;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect(this.transport);
    this.connected = true;
  }

  async listTools(): Promise<McpToolInfo[]> {
    const response = await this.client.listTools();
    return response.tools.map((tool: any) => ({
      originalName: tool.name,
      prefixedName: '',
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? { type: 'object' },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });
    return this.stringifyResult(result);
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  private stringifyResult(result: unknown): string {
    if (result && typeof result === 'object' && 'content' in result) {
      const content = (result as any).content;
      if (Array.isArray(content)) {
        return content
          .map((part: any) => {
            if (part?.type === 'text') return part.text ?? '';
            return JSON.stringify(part);
          })
          .join('\n');
      }
    }
    return JSON.stringify(result);
  }
}
