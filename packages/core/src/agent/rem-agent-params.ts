import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import type { RunDelegation } from '../delegation/types.js';
import type { Session } from '../session/model.js';
import type { AgentOrchestrationActions } from '../orchestration/orchestration-actions.js';
import type { AgentToolCapabilities } from '../runtime/agent-tool-capabilities.js';

export type REMAgentStatus = 'idle' | 'running' | 'finished' | 'error';

export interface REMAgentParams {
  agentId: string;
  /** 所属持久化 session（子 Agent 有自己的 sessionId） */
  sessionId?: string;
  /** delegate_task 的 task 摘要（用于 child-agent-update） */
  summary?: string;
  /** 异步解析在首次 run/continue 时惰性完成 */
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  session: Session;
  workspace: string;
  agentRoleId?: string;
  workspaceRoot?: string;
  /** 子 Agent 覆盖：跳过内置 system prompt 拼接 */
  systemPrompt?: string;
  /** 子 Agent 覆盖：缺省使用 behavior.maxTurns */
  maxTurns?: number;
  /** 缩减本次运行暴露的内置工具；未指定时全部启用。 */
  toolCapabilities?: AgentToolCapabilities;
  signal?: AbortSignal;
  runDelegation?: RunDelegation;
  orchestrationActions?: AgentOrchestrationActions;
}
