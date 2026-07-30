import type { McpServerConfig } from '../../../infrastructure/mcp/types.js';
import { resolveTemplate } from './config-parser.js';

/** 解析 MCP server 配置：env 字段中的 ${VAR} 模板替换为进程环境变量 */
export function resolveMcpServerConfig(config: McpServerConfig, env: NodeJS.ProcessEnv): McpServerConfig {
  const resolved: McpServerConfig = { ...config } as any;
  if (config.env) {
    const resolvedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.env)) {
      resolvedEnv[k] = resolveTemplate(v, env);
    }
    (resolved as any).env = resolvedEnv;
  }
  return resolved;
}

export function resolveMcpConfig(
  servers: Record<string, McpServerConfig>,
  env: NodeJS.ProcessEnv,
): Record<string, McpServerConfig> {
  const resolved: Record<string, McpServerConfig> = {};
  for (const [key, config] of Object.entries(servers)) {
    resolved[key] = resolveMcpServerConfig(config, env);
  }
  return resolved;
}
