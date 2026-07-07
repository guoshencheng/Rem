import type { UserInput, AgentOutput, AgentStream, ModelMessage } from './types.js';
import { AgentLiveState } from './state.js';
import { EventBus } from './events.js';
import type { Session } from './session.js';
import type { LoopStrategy, LoopContext } from './sdk/loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { ToolProvider, ToolCall, ToolResult } from './sdk/tool-provider.js';
import type { ReasonProvider, ReasonOutput } from './sdk/reason-provider.js';
import type { ExecuteProvider } from './sdk/execute-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
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
    if (!session) {
      session = {
        sessionId: params.sessionId,
        conversation: [],
        currentTurn: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await sessionProvider.save(session);
    }

    const events = new EventBus();
    const liveState = new AgentLiveState(undefined, events);
    liveState.start();

    const budgetPolicy = pm.get<BudgetPolicy>('budget') ?? {
      checkTurn: () => true,
      checkTimeout: () => true,
    };

    const startTime = Date.now();
    if (!budgetPolicy.checkTurn(liveState) || !budgetPolicy.checkTimeout(startTime)) {
      liveState.finish();
      const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
      controller.finish(output);
      return output;
    }

    const userMessage: ModelMessage = {
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: params.input.content }],
    };
    session.conversation.push(userMessage);
    await sessionProvider.save(session);

    forkTitleGeneration(session, pm, controller, sessionProvider);

    try {
      const contextProvider = pm.require<ContextProvider>('context');
      const compressor = pm.require<ContextCompressor>('compressor');
      const loopStrategy = pm.require<LoopStrategy>('loopStrategy');
      const toolProvider = pm.require<ToolProvider>('tool');
      const reasonProvider = pm.require<ReasonProvider>('reason');
      const executeProvider = pm.require<ExecuteProvider>('execute');
      const skillProvider = pm.get<SkillProvider>('skill');

      const { system, messages } = await contextProvider.build(session, behavior.name);

      let contextMessages = messages;
      if (compressor.shouldCompress(session)) {
        contextMessages = await compressor.compress(messages);
      }

      // 注入 skills 到 system prompt
      let systemWithSkills = system;
      if (skillProvider) {
        try {
          const skills = await skillProvider.loadSkills();
          const catalog = skillProvider.formatCatalog(skills);
          if (catalog) {
            systemWithSkills = `${system}\n\n${catalog}`;
          }
        } catch {
          // skill loading is best-effort
        }
      }

      // ---- 准备 LoopContext 回调 ----

      const reasonCallback = async (): Promise<ReasonOutput> => {
        return reasonProvider.reason(
          {
            provider: modelConfig.provider,
            model: modelConfig.model,
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL,
            system: systemWithSkills,
            messages: contextMessages,
            tools: toolProvider.getToolSet(),
          },
          { signal: params.signal, sessionId: params.sessionId },
          (chunk) => controller.emit(chunk),
        );
      };

      const executeCallback = async (toolCalls: ToolCall[]): Promise<ToolResult[]> => {
        return executeProvider.execute(
          toolCalls,
          {
            cwd: behavior.workspaceRoot,
            workspaceRoot: behavior.workspaceRoot,
            signal: params.signal,
            agentName: behavior.name,
            readOnly: behavior.readOnly,
            sessionId: params.sessionId,
          },
          (chunk) => controller.emit(chunk),
        );
      };

      const loopCtx: LoopContext = {
        session,
        liveState,
        system: systemWithSkills,
        messages: contextMessages,
        reason: reasonCallback,
        execute: executeCallback,
        emit: (chunk) => controller.emit(chunk),
        signal: params.signal,
        maxSteps: behavior.maxTurns,
        workspaceRoot: behavior.workspaceRoot,
        readOnly: behavior.readOnly,
        agentName: behavior.name,
        sessionId: params.sessionId,
      };

      const result = await loopStrategy.run(loopCtx);

      for (const msg of result.newMessages) {
        if (!session.conversation.includes(msg)) {
          session.conversation.push(msg);
        }
      }

      session.currentTurn++;
      liveState.finish();
      await sessionProvider.save(session);

      const output: AgentOutput = { content: result.content, completed: true };
      controller.finish(output);
      return output;
    } catch (error) {
      liveState.fail(error);
      const message = error instanceof Error ? error.message : String(error);
      const output: AgentOutput = { content: `Error: ${message}`, completed: true };
      controller.finish(output);
      await sessionProvider.save(session);
      return output;
    }
  })();

  return { stream, output: outputPromise };
}

function forkTitleGeneration(
  session: Session,
  pm: ProviderManager,
  controller: AgentStreamController,
  sessionProvider: SessionProvider,
): void {
  const titleProvider = pm.get<TitleProvider>('title');
  const modelConfig = pm.getModelConfig();
  if (!titleProvider || session.metadata.title) return;

  (async () => {
    try {
      const title = await titleProvider.generateTitle(
        session.conversation,
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
        session.metadata.title = title;
        controller.pushTitle(title);
        await sessionProvider.save(session);
      }
    } catch {
      // title generation is best-effort
    }
  })();
}
