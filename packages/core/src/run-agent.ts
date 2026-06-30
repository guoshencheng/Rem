import type { UserInput, AgentOutput, AgentStream, ModelMessage } from './types.js';
import { AgentState } from './state.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { TurnHooks } from './turn.js';
import { ReactTurnRunner } from './turn.js';
import { ReactLoop } from './loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import { AgentStreamController } from './stream/agent-stream.js';
import type { ProviderManager } from './provider-manager.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import { InferenceEngine } from './llm/engine.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  pm: ProviderManager;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentStreamController();
  const stream = controller.stream;

  const outputPromise = (async (): Promise<AgentOutput> => {
    const pm = params.pm;
    const behavior = pm.getBehaviorConfig();
    const modelConfig = pm.getModelConfig();

    const sessionProvider = pm.require<SessionProvider>('session');
    let session = await sessionProvider.load(params.sessionId);

    const state = new AgentState(session ?? undefined);
    if (session?.sessionId) {
      state.session.sessionId = session.sessionId;
    } else {
      state.session.sessionId = params.sessionId;
      await sessionProvider.save(state.session);
    }

    state.status = 'running';
    const events = new EventBus();
    await events.emit('core-agent:start', { agent: null, state });

    const budgetPolicy = pm.get<BudgetPolicy>('budget') ?? {
      checkTurn: () => true,
      checkTimeout: () => true,
    };

    const startTime = Date.now();
    if (!budgetPolicy.checkTurn(state) || !budgetPolicy.checkTimeout(startTime)) {
      state.status = 'idle';
      const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
      controller.finish(output);
      await events.emit('core-agent:stop', { agent: null, state });
      return output;
    }

    const userMessage: ModelMessage = { role: 'user', content: params.input.content };
    state.addMessage(userMessage);
    await sessionProvider.save(state.session);

    // Fork title generation concurrently with the turn
    console.log('[runAgent] forking title generation for session:', params.sessionId);
    (async () => {
      try {
        if (state.session.metadata.title) {
          console.log('[runAgent] title already exists, skip');
          return;
        }
        const userMessages = state.session.conversation.filter((m) => m.role === 'user');
        if (userMessages.length === 0) {
          console.log('[runAgent] no user messages, skip title generation');
          return;
        }
        console.log('[runAgent] generating title from', userMessages.length, 'user messages, model:', modelConfig.model);

        const engine = new InferenceEngine();
        const result = await engine.infer({
          provider: modelConfig.provider,
          providerConfig: {
            model: modelConfig.model,
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL,
          },
          system: 'Generate a concise title (10 words or fewer) summarizing the conversation topic based on the user messages below.',
          messages: userMessages.map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })),
          maxTokens: 50,
          temperature: 0.3,
          tools: {
            set_title: {
              description: 'Set the conversation title',
              parameters: {
                type: 'object',
                properties: { title: { type: 'string' } },
                required: ['title'],
              },
            },
          },
        });

        console.log('[runAgent] title result: text=%s, reasoning=%d chars, toolCalls=%d',
          JSON.stringify(result.text), result.reasoning?.length ?? 0, result.toolCalls.length);
        const tc = result.toolCalls.find((t) => t.toolName === 'set_title');
        let title = ((tc?.input as Record<string, unknown>)?.title as string ?? '').trim().slice(0, 80);
        if (!title) {
          title = result.text.trim().slice(0, 80);
        }
        if (!title && result.reasoning) {
          title = result.reasoning.trim().slice(0, 80);
        }
        console.log('[runAgent] extracted title:', JSON.stringify(title));
        if (title) {
          state.session.metadata.title = title;
          controller.pushTitle(title);
          console.log('[runAgent] session-title pushed to stream');
        }
      } catch (err) {
        console.warn('[runAgent] title generation failed:', err);
      }
    })();

    try {
      const toolProvider = pm.require<ToolProvider>('tool');
      const memoryProvider = pm.require<MemoryProvider>('memory');
      const compressor = pm.require<ContextCompressor>('compressor');
      const errorHandler = pm.require<ErrorHandler>('error');
      const skillProvider = pm.get<SkillProvider>('skill');

      const loopStrategy = new ReactLoop(
        events,
        toolProvider,
        memoryProvider,
        compressor,
        errorHandler,
        skillProvider,
      );
      const turnRunner = new ReactTurnRunner(loopStrategy);

      const result = await turnRunner.run(
        {
          input: params.input,
          conversation: [...state.conversation],
          systemPrompt: `You are ${behavior.name}.`,
          budget: state.budget,
          signal: params.signal,
          provider: modelConfig.provider,
          providerConfig: {
            model: modelConfig.model,
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL,
          },
          workspaceRoot: behavior.workspaceRoot,
          readOnly: behavior.readOnly,
          agentName: behavior.name,
        },
        createTurnHooks(state),
        controller,
      );

      for (const msg of result.newMessages) {
        state.addMessage(msg);
      }

      state.currentTurn++;
      state.status = 'idle';
      await sessionProvider.save(state.session);
      await events.emit('core-agent:stop', { agent: null, state });

      const output: AgentOutput = {
        content: result.output.content,
        completed: true,
      };
      controller.finish(output);
      return output;
    } catch (error) {
      state.status = 'error';
      const message = error instanceof Error ? error.message : String(error);
      const output: AgentOutput = { content: `Error: ${message}`, completed: true };
      controller.finish(output);
      await events.emit('core-agent:error', { agent: null, state, error });
      await sessionProvider.save(state.session);
      return output;
    }
  })();

  return { stream, output: outputPromise };
}

function createTurnHooks(state: AgentState): TurnHooks {
  return {
    onMessageAdded: () => {},
    onToolCallRecorded: (record) => {
      state.session.metadata.lastToolCall = record;
    },
  };
}
