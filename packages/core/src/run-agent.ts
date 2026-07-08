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
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import { AgentStreamController } from './stream/agent-stream.js';
import type { AgentContext } from './agent-context.js';
import { generateId } from './shared/generate-id.js';
import { reason } from './reason/reason.js';
import { executeTools } from './execute/execute-tools.js';
import { AgentState } from './agent-state.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  ctx: AgentContext;
  agentState: AgentState;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentStreamController();
  const stream = controller.stream;

  const outputPromise = (async (): Promise<AgentOutput> => {
    const ctx = params.ctx;
    const behavior = ctx.configProvider.getBehaviorConfig();
    const modelConfig = ctx.configProvider.getModelConfig();

    const sessionProvider = ctx.sessionProvider;
    let session = await sessionProvider.load(params.sessionId);
    if (!session) {
      session = {
        sessionId: params.sessionId, conversation: [], currentTurn: 0, metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      };
      await sessionProvider.save(session);
    }

    const events = new EventBus();
    const liveState = params.agentState.getOrCreate(params.sessionId);
    liveState.attachEvents(events);

    // AgentService 已通过 startRun 将状态置为 running；直接调用 runAgent 时在这里启动
    if (liveState.status !== 'running') {
      liveState.start({ clearSnapshot: true });
    }

    if (!ctx.budgetPolicy.checkTurn(liveState) || !ctx.budgetPolicy.checkTimeout(Date.now())) {
      const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
      controller.finish(output);
      return output;
    }

    session.conversation.push({
      id: generateId(), role: 'user',
      content: [{ type: 'text', text: params.input.content }],
    } as ModelMessage);
    await sessionProvider.save(session);

    forkTitleGeneration(session, ctx.titleProvider, controller, sessionProvider);

    try {
      const contextProvider = ctx.contextProvider;
      const compressor = ctx.compressor;
      const loopStrategy = ctx.loopStrategy;
      const toolProvider = ctx.toolProvider;
      const mcpProviders = ctx.mcpProviders;
      const skillProvider = ctx.skillProvider;
      const toolComposer = ctx.toolComposer;
      const errorHandler = ctx.errorHandler;
      const addMessage = (role: 'assistant' | 'tool') => sessionProvider.addMessage(session, role);
      const appendContent = (msg: ModelMessage, part: any) => sessionProvider.appendContent(session, msg, part);

      const { system, messages } = await contextProvider.build(session, behavior.name);

      let msgs = compressor.shouldCompress(session) ? await compressor.compress(messages) : messages;

      let systemWithSkills = system;
      try {
        const skills = await skillProvider.loadSkills();
        const catalog = skillProvider.formatCatalog(skills);
        if (catalog) systemWithSkills = `${system}\n\n${catalog}`;
      } catch { /* best-effort */ }

      const effectiveToolProvider = toolComposer.compose({
        toolProvider,
        mcpProviders,
        skillProvider,
      });

      const loopCtx: LoopContext = {
        liveState,
        messages: msgs,
        addMessage,
        appendContent,
        system: systemWithSkills,
        reason: () => reason(
          {
            provider: modelConfig.provider, model: modelConfig.model, apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL, system: systemWithSkills, messages: msgs,
            tools: effectiveToolProvider.getToolSet(), signal: params.signal, errorHandler,
          },
          (chunk) => controller.emit(chunk),
        ),
        execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
          toolCalls: calls, toolProvider: effectiveToolProvider, addMessage, appendContent,
          agentState: params.agentState,
          workspaceRoot: behavior.workspaceRoot, agentName: behavior.name,
          readOnly: behavior.readOnly, sessionId: params.sessionId, signal: params.signal,
          emit: (chunk) => controller.emit(chunk),
        }),
        emit: (chunk) => controller.emit(chunk),
        signal: params.signal, maxSteps: behavior.maxTurns,
        workspaceRoot: behavior.workspaceRoot, readOnly: behavior.readOnly,
        agentName: behavior.name, sessionId: params.sessionId,
      };

      const result = await loopStrategy.run(loopCtx);

      session.currentTurn++;
      await sessionProvider.save(session);

      const output: AgentOutput = { content: result.content, completed: true };
      controller.finish(output);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const output: AgentOutput = { content: `Error: ${message}`, completed: true };
      controller.fail(error instanceof Error ? error : new Error(message));
      await sessionProvider.save(session);
      return output;
    }
  })();

  return { stream, output: outputPromise };
}

function forkTitleGeneration(
  session: Session,
  titleProvider: TitleProvider,
  controller: AgentStreamController,
  sessionProvider: SessionProvider,
): void {
  if (session.metadata.title) return;
  (async () => {
    try {
      const title = await titleProvider.generateTitle(session.conversation);
      if (title) { session.metadata.title = title; controller.pushTitle(title); await sessionProvider.save(session); }
    } catch { /* best-effort */ }
  })();
}
