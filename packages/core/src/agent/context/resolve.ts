import type { Skill } from '../../sdk/skill-provider.js';
import type { PromptBuildContext } from '../../sdk/system-prompt.js';
import { listPromptToolSummaries } from '../../tools/prompt-tool-summary.js';
import type { REMAgentContext, ResolveREMAgentContextParams } from './types.js';

export type { REMAgentContext, ResolveREMAgentContextParams } from './types.js';

export async function resolveREMAgentContext(params: ResolveREMAgentContextParams): Promise<REMAgentContext> {
  const { di, runtimeConfig, session, workspace } = params;
  const configProvider = di.configProvider.forWorkspace?.(workspace) ?? di.configProvider;
  const behavior = configProvider.getBehaviorConfig();
  const modelConfig = configProvider.getModelConfig();
  const agentRole = configProvider.resolveAgent(params.agentRoleId);
  const effectiveModel = agentRole.model ?? modelConfig;
  const workspaceRoot = params.workspaceRoot ?? workspace ?? behavior.workspaceRoot;

  const [{ messages }, skills] = await Promise.all([
    di.contextProvider.build(session, behavior.name),
    di.skillProvider.loadSkills().catch(() => [] as Skill[]),
  ]);

  const tools = listPromptToolSummaries({
    toolProvider: di.toolProvider,
    mcpProviders: di.mcpProviders,
    skillProvider: di.skillProvider,
  });

  const buildCtx: PromptBuildContext = {
    agentName: agentRole.name,
    workspaceRoot,
    readOnly: behavior.readOnly,
    tools,
    skills,
    model: { provider: effectiveModel.provider, model: effectiveModel.model },
    runtime: {
      platform: runtimeConfig.runtime.platform,
      nodeVersion: runtimeConfig.runtime.nodeVersion ?? runtimeConfig.runtime.platform,
      today: new Date().toISOString().split('T')[0],
    },
    agentCorePrompt: agentRole.corePrompt,
  };

  const systemPrompt = await di.systemPromptAssembler.assemble(buildCtx);

  return { messages, systemPrompt, effectiveModel, behavior, configProvider, workspaceRoot };
}
