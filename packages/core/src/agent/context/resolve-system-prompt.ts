import type { Skill } from '../../sdk/skill-provider.js';
import type { PromptBuildContext } from '../../sdk/system-prompt.js';
import type { AgentDI } from '../../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../../assembly/runtime-config.js';
import { listPromptToolSummaries } from '../../tools/prompt-tool-summary.js';
import type { AgentConfigResolution } from './resolve-config.js';

export interface ResolveSystemPromptParams {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  resolution: AgentConfigResolution;
}

/** 构建 system prompt：加载 skills + 工具摘要 → PromptBuildContext → assembler */
export async function resolveSystemPrompt(params: ResolveSystemPromptParams): Promise<string> {
  const { di, runtimeConfig, resolution } = params;
  const { agentRole, workspaceRoot, behavior, effectiveModel } = resolution;

  const skills = await di.skillProvider.loadSkills().catch(() => [] as Skill[]);
  const tools = listPromptToolSummaries({
    toolProvider: di.toolProvider,
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

  return di.systemPromptAssembler.assemble(buildCtx);
}
