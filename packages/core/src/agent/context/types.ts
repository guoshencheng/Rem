import type { AgentDI } from '../../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../../assembly/runtime-config.js';
import type { Session } from '../../session/model.js';

/** resolveAgentConfig 的输入 */
export interface ResolveAgentConfigParams {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  /** 已由 SessionService 加载/创建的 session */
  session: Session;
  workspace: string;
  agentRoleId?: string;
  workspaceRoot?: string;
}
