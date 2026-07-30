import type { SecurityMode } from '../security/permissions/factory.js';

export interface AgentRuntimeInfo {
  platform: string;
  nodeVersion?: string;
  // TODO: env 不应该传入，看看是否只是依赖cwd，其他的Agent可以自己通过 shell 自己获取到
  env: Record<string, string | undefined>;
}

export interface AgentRuntimeConfig {
  securityMode: SecurityMode;
  runtime: AgentRuntimeInfo;
}
