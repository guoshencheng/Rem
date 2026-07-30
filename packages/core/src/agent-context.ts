import type { Message } from '@earendil-works/pi-ai';
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig } from './agent-runtime-config.js';
import type { Session } from './session.js';
import type { AgentBehaviorConfig, ConfigProvider, ResolvedModelConfig } from './sdk/config-provider.js';
import type { PromptBuildContext } from './sdk/system-prompt.js';
import type { Skill } from './sdk/skill-provider.js';
import { composeToolProviders } from './tool-composer.js';
import { createTodoWriteToolDefinition } from './plugins/tool/builtin/todo-write.js';
import { createDelegateTaskToolDefinitionV2 } from './delegate-task-v2.js';

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

  // systemPrompt 的工具清单：composed providers + 两个 overlay 工具（无需真建 overlay）
  const composed = composeToolProviders({
    toolProvider: di.toolProvider,
    mcpProviders: di.mcpProviders,
    skillProvider: di.skillProvider,
  });
  const delegateDef = createDelegateTaskToolDefinitionV2();
  const todoDef = createTodoWriteToolDefinition();
  const tools = [
    ...composed.getToolSet().map((t) => ({ name: t.name, description: t.description })),
    { name: delegateDef.name, description: delegateDef.description },
    { name: todoDef.name, description: todoDef.description },
  ];

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
