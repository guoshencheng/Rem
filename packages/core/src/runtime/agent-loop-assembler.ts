import type { Message } from '@earendil-works/pi-ai';
import type { AgentContext, AgentLoopConfig, StreamFn } from '@earendil-works/pi-agent-core';
import { resolveAgentConfig } from '../agent/context/resolve-config.js';
import { resolveSystemPrompt } from '../agent/context/resolve-system-prompt.js';
import type { AgentStreamEvent, RemMetaEvent } from '../agent/types.js';
import { reduceTokenUsage } from '../agent/token-usage/index.js';
import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import { createDelegateTaskExecutor, createDelegateTaskToolDefinition } from '../capabilities/sub-agent/delegate-task.js';
import type { RunDelegation } from '../delegation/types.js';
import { TodoUsecase } from '../capabilities/todo/todo-usecase.js';
import { createTodoWriteToolDefinition, createTodoWriteToolExecutor } from '../capabilities/todo/tool.js';
import { resolveContextWindow } from '../infrastructure/llm/context-window.js';
import type { Session } from '../session/model.js';
import { defineOverlayTool } from '../tools/overlay.js';
import { createAgentTools } from './agent-tools.js';
import { createCompressionTransform } from './compression-transform.js';
import { archiveConversation } from './conversation-archive.js';

export interface AgentLoopAssemblyInput {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  session: Session;
  sessionId?: string;
  workspace: string;
  agentRoleId?: string;
  workspaceRoot?: string;
  systemPrompt?: string;
  maxTurns?: number;
  runDelegation?: RunDelegation;
  messages: () => Message[];
  drainSteering: () => Message[];
  drainFollowUp: () => Message[];
  emitMeta: (event: RemMetaEvent) => void;
}

export interface AssembledAgentLoop {
  context: AgentContext;
  config: AgentLoopConfig;
  streamFn: StreamFn;
  maxTurns: number | undefined;
}

export async function assembleAgentLoop(input: AgentLoopAssemblyInput): Promise<AssembledAgentLoop> {
  const { di, runtimeConfig, session } = input;
  const resolution = resolveAgentConfig({
    di, runtimeConfig, session, workspace: input.workspace,
    agentRoleId: input.agentRoleId, workspaceRoot: input.workspaceRoot,
  });
  const systemPrompt = input.systemPrompt
    ?? await resolveSystemPrompt({ di, runtimeConfig, resolution });
  const sessionId = input.sessionId ?? session.sessionId;
  const { effectiveModel, behavior, configProvider } = resolution;
  const runDelegation: RunDelegation = input.runDelegation ?? (async () => {
    throw new Error('delegate_task is not available for this agent');
  });
  const agentTools = createAgentTools({
    toolProvider: di.toolProvider,
    skillProvider: di.skillProvider,
    delegateToolProviderEntry: defineOverlayTool(
      createDelegateTaskToolDefinition(),
      createDelegateTaskExecutor(runDelegation),
    ),
    todoToolProviderEntry: defineOverlayTool(
      createTodoWriteToolDefinition(),
      createTodoWriteToolExecutor(new TodoUsecase(di.storage.todoStore), input.emitMeta),
    ),
    workspaceRoot: resolution.workspaceRoot,
    agentName: behavior.name,
    sessionId,
  });
  const transformContext = createCompressionTransform({
    compressor: di.compressor,
    shouldCompress: (messages) => di.compressor.shouldCompress({ ...session, conversation: messages }),
    estimatedTokens: () => reduceTokenUsage(session.metadata.tokenUsageHistory as unknown[] ?? []) ?? 0,
    threshold: () => resolveContextWindow(
      effectiveModel.provider, effectiveModel.model, runtimeConfig.runtime.env, di.models,
    ) * configProvider.getCompressionConfig().thresholdRatio,
    archive: (before) => archiveConversation(di.storage.archiveStore, sessionId, before),
    emit: (event: AgentStreamEvent) => input.emitMeta(event as RemMetaEvent),
    sessionId,
  });
  const resolved = di.models.getModel(effectiveModel.provider, effectiveModel.model);
  if (!resolved) throw new Error(`Unknown model: ${effectiveModel.provider}/${effectiveModel.model}`);
  const config: AgentLoopConfig = {
    model: effectiveModel.baseURL ? { ...resolved, baseUrl: effectiveModel.baseURL } : resolved,
    reasoning: effectiveModel.reasoning,
    sessionId,
    toolExecution: 'sequential',
    convertToLlm: (messages) => messages.filter(
      (message) => message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult',
    ) as Message[],
    transformContext: (messages) => transformContext(messages as Message[]),
    getApiKey: () => effectiveModel.apiKey || undefined,
    getSteeringMessages: async () => input.drainSteering(),
    getFollowUpMessages: async () => input.drainFollowUp(),
  };
  const streamFn: StreamFn = (model, context, options) => di.models.streamSimple(model, context, {
    ...options,
    apiKey: effectiveModel.apiKey || undefined,
  });
  return {
    context: { systemPrompt, messages: input.messages(), tools: agentTools.tools },
    config,
    streamFn,
    maxTurns: input.maxTurns ?? behavior.maxTurns,
  };
}
