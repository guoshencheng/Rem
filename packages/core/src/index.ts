export * from './types.js';
export { createCoreModels, type CreateCoreModelsOptions } from './infrastructure/llm/models.js';
export type { Message, TextContent, ImageContent, ThinkingContent, ToolCall, Usage, AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
export type { AgentEvent } from '@earendil-works/pi-agent-core';
export * from './infrastructure/config/paths.js';
export * from './infrastructure/observability/debug-log.js';
export * from './budget.js';
export * from './session/model.js';
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
export { classifyCommand } from './security/permissions/exec-classifier.js';
export { ApprovalEngine, type ApprovalResolution } from './security/approval/approval-engine.js';
export * from './sdk/index.js';
export * from './plugins/index.js';
export * from './tools/registry.js';
export * from './capabilities/todo/types.js';
export * from './capabilities/todo/errors.js';
export * from './capabilities/todo/service.js';
export * from './session/manager/index.js';
export * from './token-usage.js';
export * from './infrastructure/llm/context-window.js';

// --- v2 复用支持 ---
export { composeToolProviders } from './tools/composer.js';
export { ToolOverlay, defineOverlayTool, type ToolOverlayEntry } from './tools/overlay.js';
export { createToolBridge, type ToolBridgeParams, type ToolBridge } from './run-agent/tool-bridge.js';
export { createContextBridge, type ContextBridgeParams, type ContextBridge } from './run-agent/context-bridge.js';
export { createPiAgent, type PiAgentFactoryParams } from './run-agent/pi-agent-factory.js';
export {
  createTodoWriteToolDefinition,
  createTodoWriteToolExecutor,
} from './plugins/tool/builtin/todo-write.js';
export { buildChildContext, type BuildChildContextOptions } from './capabilities/sub-agent/build-child-context.js';
export { formatTaskResult } from './capabilities/sub-agent/format-task-result.js';
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
  createDelegateTaskExecutor,
  createDelegateTaskToolDefinition,
  type DelegateTaskExecutorParams,
  type DelegateTaskInput,
  type SpawnChild,
} from './capabilities/sub-agent/delegate-task.js';
export * from './compat.js';
