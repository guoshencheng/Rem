import type { Models, Message, AssistantMessage } from '@earendil-works/pi-ai';
import { runAgentLoop, runAgentLoopContinue } from '@earendil-works/pi-agent-core';
import type { AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from '@earendil-works/pi-agent-core';
import type { ToolProvider } from '../../sdk/tool-provider.js';
import { createRuntimeAgentTools } from './runtime-agent-tool-bridge.js';
import type { RuntimeAgentLoopInput, RuntimeAgentLoopResult } from './runtime-agent-loop-types.js';

export async function runRuntimeAgentLoop(input: RuntimeAgentLoopInput): Promise<RuntimeAgentLoopResult> {
  const model = input.models.getModel(input.model.provider, input.model.model);
  if (!model) throw new Error(`Unknown model: ${input.model.provider}/${input.model.model}`);

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (input.signal.aborted) controller.abort();
  else input.signal.addEventListener('abort', abort, { once: true });

  const messages = input.messages.slice();
  let turns = 0;
  let lastAssistant: AssistantMessage | undefined;
  const onEvent = async (event: AgentEvent): Promise<void> => {
    await input.onEvent(event);
    if (event.type === 'message_end') messages.push(event.message as Message);
    if (event.type === 'turn_end' && event.message.role === 'assistant') {
      turns += 1;
      lastAssistant = event.message as AssistantMessage;
      if (input.maxTurns !== undefined && turns >= input.maxTurns) controller.abort();
    }
  };
  const config = createLoopConfig(input, model, createRuntimeAgentTools(
    input.toolProvider, input.sessionId, input.executionRoot, input.agentName, input.readOnly,
  ));
  const context = { systemPrompt: input.systemPrompt, messages: messages as AgentMessage[], tools: config.tools };
  try {
    if (input.resume) {
      await runAgentLoopContinue(context, config.loop, onEvent, controller.signal, config.streamFn);
    } else {
      await runAgentLoop(
        input.userMessage ? [input.userMessage as AgentMessage] : [], context,
        config.loop, onEvent, controller.signal, config.streamFn,
      );
    }
    return {
      messages,
      lastAssistant,
      output: assistantText(lastAssistant),
    };
  } finally {
    input.signal.removeEventListener('abort', abort);
  }
}

function createLoopConfig(
  input: RuntimeAgentLoopInput,
  model: NonNullable<ReturnType<Models['getModel']>>,
  tools: ReturnType<typeof createRuntimeAgentTools>,
): { loop: AgentLoopConfig; tools: ReturnType<typeof createRuntimeAgentTools>; streamFn: StreamFn } {
  const loop: AgentLoopConfig = {
    model,
    reasoning: input.model.reasoning,
    sessionId: input.sessionId,
    toolExecution: 'sequential',
    convertToLlm: (messages) => messages.filter(isLlmMessage) as Message[],
    getApiKey: () => input.model.apiKey || undefined,
  };
  const streamFn: StreamFn = (resolvedModel, context, options) =>
    input.models.streamSimple(resolvedModel, context, {
      ...options,
      apiKey: input.model.apiKey || undefined,
    });
  return { loop, tools, streamFn };
}

function assistantText(message: AssistantMessage | undefined): string {
  if (!message) return '';
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
}

function isLlmMessage(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}
