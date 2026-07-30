export interface McpStdioServerConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface McpSseServerConfig {
  transport: 'sse';
  url: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig;

export interface McpServerEntry {
  name: string;
  prefix: string;
  config: McpServerConfig;
  disabled?: boolean;
}

export interface McpConnectionState {
  status: 'connecting' | 'connected' | 'error';
  error?: string;
}

export interface McpToolInfo {
  originalName: string;
  prefixedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerState {
  name: string;
  state: McpConnectionState;
  tools: McpToolInfo[];
}
