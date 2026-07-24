import type { PromptBuildContext, AgentPromptTemplate } from '../../sdk/system-prompt.js';
import { renderAgentRoleVariables } from '../variables/agent-role-variables.js';
import { CLAUDE_TEMPLATE } from './generated-templates.js';

export class ClaudeAgentPromptTemplate implements AgentPromptTemplate {
  readonly name = 'claude';

  async render(ctx: PromptBuildContext): Promise<string> {
    return renderAgentRoleVariables(CLAUDE_TEMPLATE, {
      agentName: ctx.agentName,
      agentCorePrompt: ctx.agentCorePrompt,
    });
  }
}
