export interface ToolInfo {
  name: string;
  description: string;
}

export interface PromptBuildContext {
  agentName: string;
  workspaceRoot: string;
  readOnly: boolean;
  tools: ToolInfo[];
  skills: import('./skill-provider.js').Skill[];
  model: { provider: string; model: string };
  runtime: {
    platform: string;
    nodeVersion: string;
    today: string;
    cwd: string;
  };
  agentCorePrompt: string;
}

export interface AgentPromptTemplate {
  readonly name: string;
  render(ctx: PromptBuildContext): string | Promise<string>;
}

export interface AgentPromptTemplateSelector {
  select(ctx: PromptBuildContext): AgentPromptTemplate;
}

export interface PromptSection {
  readonly name: string;
  render(ctx: PromptBuildContext): string | undefined | Promise<string | undefined>;
}

export interface SystemPromptAssembler {
  assemble(ctx: PromptBuildContext): Promise<string>;
}

export interface AgentInstructionLoader {
  load(workspaceRoot: string, agentName: string): Promise<string | undefined>;
}
