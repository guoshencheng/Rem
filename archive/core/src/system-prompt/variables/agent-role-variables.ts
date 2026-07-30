export interface AgentRoleVariables {
  agentName: string;
  agentCorePrompt: string;
}

export function renderAgentRoleVariables(template: string, vars: AgentRoleVariables): string {
  return template
    .replace(/\{\{agentRolePrompt\}\}/g, vars.agentCorePrompt)
    .replace(/\{\{agentName\}\}/g, vars.agentName);
}
