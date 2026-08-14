import type { AssistantMessage, Message, Models } from '@earendil-works/pi-ai';
import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { AgentRun } from '../domain/run/types.js';
import type { RuntimeObservationSink } from '../sdk/runtime-observer.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { buildSystemPrompt } from './single-agent-executor-boundaries.js';
import { observeModel } from './model-observation.js';
import { runRuntimeAgentLoop } from './agent-loop/runtime-agent-loop.js';
import { isModelError } from './single-agent-executor-messages.js';

export async function runSingleAgentModelTurn(input: {
  run: AgentRun;
  definition: AgentDefinition;
  model: Parameters<typeof observeModel>[3];
  messages: Message[];
  userMessage: Message | undefined;
  agentName: string;
  readOnly: boolean;
  resume: boolean;
  models: Models;
  toolProvider: ToolProvider;
  sessionId: string;
  executionRoot: string;
  maxTurns: number;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => Promise<void>;
  observe?: RuntimeObservationSink;
}): Promise<AssistantMessage | undefined> {
  const startedAt = Date.now();
  observeModel(input.observe, 'started', input.run, input.model, startedAt);
  try {
    const loop = await runRuntimeAgentLoop({
      messages: input.messages, systemPrompt: buildSystemPrompt(input.definition, input.run),
      userMessage: input.userMessage, agentName: input.agentName, readOnly: input.readOnly,
      resume: input.resume, model: input.model, models: input.models, toolProvider: input.toolProvider,
      sessionId: input.sessionId, executionRoot: input.executionRoot, maxTurns: input.maxTurns,
      signal: input.signal, onEvent: input.onEvent,
    });
    if (loop.lastAssistant && isModelError(loop.lastAssistant)) {
      observeModel(input.observe, 'failed', input.run, input.model, startedAt, undefined, 'MODEL_EXECUTION_FAILED', loop.lastAssistant.errorMessage);
    } else {
      observeModel(input.observe, 'completed', input.run, input.model, startedAt, loop.lastAssistant);
    }
    return loop.lastAssistant;
  } catch (error) {
    observeModel(input.observe, 'failed', input.run, input.model, startedAt, undefined,
      error instanceof RuntimeError ? error.code : 'INTERNAL_ERROR', error);
    throw error;
  }
}
