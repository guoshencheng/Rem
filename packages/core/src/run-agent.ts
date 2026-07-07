import type { UserInput, AgentOutput, AgentStream, ModelMessage } from './types.js';
import { AgentState } from './state.js';
import { EventBus } from './events.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import { AgentStreamController } from './stream/agent-stream.js';
import type { ProviderManager } from './provider-manager.js';
import { generateId } from './shared/generate-id.js';

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
    state.session.sessionId = session?.sessionId ?? params.sessionId;
    if (!session) {
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

    const userMessage: ModelMessage = {
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: params.input.content }],
    };
    state.addMessage(userMessage);
    await sessionProvider.save(state.session);

    forkTitleGeneration(state, pm, controller, sessionProvider);

    try {
      const contextProvider = pm.require<ContextProvider>('context');
      const compressor = pm.require<ContextCompressor>('compressor');
      const loopStrategy = pm.require<LoopStrategy>('loopStrategy');
      const toolProvider = pm.require<ToolProvider>('tool');

      const { system, messages } = await contextProvider.build(state);

      let contextMessages = messages;
      if (compressor.shouldCompress(state)) {
        contextMessages = await compressor.compress(messages);
      }

      const result = await loopStrategy.run({
        state,
        system,
        messages: contextMessages,
        tools: toolProvider.getToolSet(),
        budget: state.budget,
        emit: (chunk) => controller.emit(chunk),
        signal: params.signal,
        maxSteps: behavior.maxTurns,
        workspaceRoot: behavior.workspaceRoot,
        readOnly: behavior.readOnly,
        agentName: behavior.name,
        sessionId: params.sessionId,
        provider: modelConfig.provider,
        modelConfig: {
          model: modelConfig.model,
          apiKey: modelConfig.apiKey,
          baseURL: modelConfig.baseURL,
        },
      });

      for (const msg of result.newMessages) {
        if (!state.conversation.includes(msg)) {
          state.addMessage(msg);
        }
      }

      state.currentTurn++;
      state.status = 'idle';
      await sessionProvider.save(state.session);
      await events.emit('core-agent:stop', { agent: null, state });

      const output: AgentOutput = { content: result.content, completed: true };
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

function forkTitleGeneration(
  state: AgentState,
  pm: ProviderManager,
  controller: AgentStreamController,
  sessionProvider: SessionProvider,
): void {
  const titleProvider = pm.get<TitleProvider>('title');
  const modelConfig = pm.getModelConfig();
  if (!titleProvider || state.session.metadata.title) return;

  (async () => {
    try {
      const title = await titleProvider.generateTitle(
        state.session.conversation,
        {
          provider: modelConfig.provider,
          providerConfig: {
            model: modelConfig.model,
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL,
          },
        },
      );
      if (title) {
        state.session.metadata.title = title;
        controller.pushTitle(title);
        await sessionProvider.save(state.session);
      }
    } catch {
      // title generation is best-effort
    }
  })();
}
