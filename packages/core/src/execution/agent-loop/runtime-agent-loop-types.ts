import type { Models, Message, AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentEvent, AgentTool } from '@earendil-works/pi-agent-core';
import type { ResolvedRuntimeModelConfig } from '../../sdk/runtime-config-provider.js';
import type { ToolProvider } from '../../sdk/tool-provider.js';

export interface RuntimeAgentLoopInput {
  messages: readonly Message[];
  systemPrompt: string;
  userMessage?: Message;
  resume: boolean;
  model: ResolvedRuntimeModelConfig;
  models: Models;
  toolProvider: ToolProvider;
  sessionId: string;
  executionRoot: string;
  agentName?: string;
  readOnly?: boolean;
  maxTurns?: number;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void | Promise<void>;
}

export interface RuntimeAgentLoopResult {
  messages: Message[];
  lastAssistant?: AssistantMessage;
  output: string;
}

export type RuntimeAgentTool = AgentTool;
