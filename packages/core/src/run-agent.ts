import type { UserInput, AgentOutput, AgentStream, ModelMessage } from './types.js';
import { AgentState } from './state.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { TurnHooks } from './turn.js';
import { ReactTurnRunner } from './turn.js';
import { ReactLoop } from './loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import { AgentStreamController } from './stream/agent-stream.js';
import { createProviderManager } from './provider-manager.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentStreamController();
  const stream = controller.stream;

  const outputPromise = (async (): Promise<AgentOutput> => {
    const pm = await createProviderManager();
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
