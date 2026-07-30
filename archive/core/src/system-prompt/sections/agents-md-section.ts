import type { PromptBuildContext, PromptSection, AgentInstructionLoader } from '../../sdk/system-prompt.js';

export class AgentsMdSection implements PromptSection {
  readonly name = 'agents-md';

  constructor(private loader: AgentInstructionLoader) {}

  async render(ctx: PromptBuildContext): Promise<string | undefined> {
    const content = await this.loader.load(ctx.workspaceRoot, ctx.agentName);
    if (!content) return undefined;
    return `## Project Instructions\n\n${content}`;
  }
}
