import type { PromptBuildContext, AgentPromptTemplate } from '../../sdk/system-prompt.js';
import { renderAgentRoleVariables } from '../variables/agent-role-variables.js';
import { OPENAI_TEMPLATE } from './generated-templates.js';

export class OpenAiAgentPromptTemplate implements AgentPromptTemplate {
  readonly name = 'openai';

  async render(ctx: PromptBuildContext): Promise<string> {
    return renderAgentRoleVariables(OPENAI_TEMPLATE, {
      agentName: ctx.agentName,
      agentCorePrompt: ctx.agentCorePrompt,
    });
  }
}
