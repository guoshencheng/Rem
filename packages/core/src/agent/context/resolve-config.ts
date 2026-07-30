import type { AgentBehaviorConfig, ConfigProvider, ResolvedModelConfig } from '../../sdk/config-provider.js';
import type { ResolvedAgentRole } from '../../sdk/agent-role.js';
import type { ResolveAgentConfigParams } from './types.js';

/** configProvider 层面的解析产物：behavior / 生效模型 / 角色 / workspaceRoot */
export interface AgentConfigResolution {
  behavior: Required<AgentBehaviorConfig>;
  configProvider: ConfigProvider;
  effectiveModel: ResolvedModelConfig;
  agentRole: ResolvedAgentRole;
  workspaceRoot: string;
}

/** 解析 workspace 作用域的 configProvider 及其行为/模型/角色配置（纯同步，无 IO） */
export function resolveAgentConfig(params: ResolveAgentConfigParams): AgentConfigResolution {
  const { di, workspace } = params;
  const configProvider = di.configProvider.forWorkspace?.(workspace) ?? di.configProvider;
  const behavior = configProvider.getBehaviorConfig();
  const agentRole = configProvider.resolveAgent(params.agentRoleId);
  const effectiveModel = agentRole.model ?? configProvider.getModelConfig();
  const workspaceRoot = params.workspaceRoot ?? workspace ?? behavior.workspaceRoot;
  return { behavior, configProvider, effectiveModel, agentRole, workspaceRoot };
}
