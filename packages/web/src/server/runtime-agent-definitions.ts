import type { AgentDefinition } from 'rem-agent-core';
import { StaticAgentDefinitionProvider } from 'rem-agent-core';

export const WEB_AGENT_ID = 'web-agent';

/** 将宿主配置中的默认角色固定为可审计的 Runtime Definition。 */
export function createWebAgentDefinitions(): StaticAgentDefinitionProvider {
  const definition: AgentDefinition = {
    agentId: WEB_AGENT_ID,
    revision: '1',
    name: 'Web Agent',
    instructions: '你是一个负责帮助用户完成任务的企业 Agent。请清晰、准确地执行请求。',
    modelId: 'default',
    toolNames: [],
    acceptedTriggers: ['message'],
    execution: { type: 'single-agent' },
  };
  return new StaticAgentDefinitionProvider([definition]);
}
