export * from './types.js';
export { createCoreModels, type CreateCoreModelsOptions } from './llm/models.js';
export type { Message, TextContent, ImageContent, ThinkingContent, ToolCall, Usage, AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
export type { AgentEvent } from '@earendil-works/pi-agent-core';
export * from './config/paths.js';
export * from './shared/debug-log.js';
export * from './budget.js';
export * from './session.js';
export * from './bus-events.js';
export * from './broadcast-bus.js';
export * from './agent-factory.js';
export { createAgentAssembly, type AgentContextBuildOptions } from './agent-context-builder.js';
export type { AgentDI } from './agent-di.js';
export type { AgentRuntimeConfig, AgentRuntimeInfo } from './agent-runtime-config.js';
export type { AgentAssembly } from './agent-context-assembler.js';
export { initRuleEngine, initializeAgentDI } from './agent-context-assembler.js';
export * from './stream/event-aggregators.js';
export type { Rule, RuleAction, RuleSource } from './security/rules/rule.js';
export type { ToolProfileId } from './security/rules/profiles.js';
export { RuleEngine } from './security/rules/rule-engine.js';
export { RuleStore } from './security/rules/rule-store.js';
export { getProfileRules } from './security/rules/profiles.js';
export { classifyCommand } from './security/exec-classifier.js';
export { ApprovalEngine, type ApprovalResolution } from './execute/approval-engine.js';
export * from './sdk/index.js';
export * from './plugins/index.js';
export * from './registry/tool-registry.js';
export * from './todo/types.js';
export * from './todo/errors.js';
export * from './todo/service.js';
export * from './session-manager/index.js';
export * from './token-usage.js';
export * from './llm/context-window.js';

// --- v2 复用支持 ---
export { composeToolProviders } from './tool-composer.js';
export { ToolOverlay, defineOverlayTool, type ToolOverlayEntry } from './tool-overlay.js';
export { createToolBridge, type ToolBridgeParams, type ToolBridge } from './run-agent/tool-bridge.js';
export { createContextBridge, type ContextBridgeParams, type ContextBridge } from './run-agent/context-bridge.js';
export { createPiAgent, type PiAgentFactoryParams } from './run-agent/pi-agent-factory.js';
export {
  createTodoWriteToolDefinition,
  createTodoWriteToolExecutor,
} from './plugins/tool/builtin/todo-write.js';
export { buildChildContext, type BuildChildContextOptions } from './sub-agent/build-child-context.js';
export { formatTaskResult } from './sub-agent/format-task-result.js';
export { generateId } from './shared/generate-id.js';
export type { PromptBuildContext } from './sdk/system-prompt.js';

// --- v2 执行单元 ---
export { EventQueue } from './event-queue.js';
export type { PiAgentLike } from './pi-agent-like.js';
export type { REMAgentEvent } from './rem-agent-event.js';
export { REMAgent, type REMAgentStatus, type REMAgentParams, type ApprovalStateLike } from './rem-agent.js';
export {
  resolveREMAgentContext,
  type REMAgentContext,
  type ResolveREMAgentContextParams,
} from './agent-context.js';
export {
  createDelegateTaskExecutorV2,
  createDelegateTaskToolDefinitionV2,
  type DelegateTaskExecutorV2Params,
  type DelegateTaskInputV2,
  type SpawnChild,
} from './delegate-task-v2.js';
