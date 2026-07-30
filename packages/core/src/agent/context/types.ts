import type { Message } from '@earendil-works/pi-ai';
import type { AgentDI } from '../../agent-di.js';
import type { AgentRuntimeConfig } from '../../agent-runtime-config.js';
import type { Session } from '../../session/model.js';
import type { AgentBehaviorConfig, ConfigProvider, ResolvedModelConfig } from '../../sdk/config-provider.js';

/** REMAgent 构造所需的全部预解析产物（异步部分在此收敛，构造函数保持同步） */
export interface REMAgentContext {
  messages: Message[];
  systemPrompt: string;
  effectiveModel: ResolvedModelConfig;
  behavior: Required<AgentBehaviorConfig>;
  configProvider: ConfigProvider;
  workspaceRoot: string;
}

export interface ResolveREMAgentContextParams {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  /** 已由 SessionService 加载/创建的 session */
  session: Session;
  workspace: string;
  agentRoleId?: string;
  workspaceRoot?: string;
}
