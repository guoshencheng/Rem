import type { UserInput, AgentOutput, AgentStream, ModelMessage, ProviderChunk, LanguageModelUsage } from './types.js';
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
import type { ToolSet, StreamChunk } from './llm/types.js';
import { resolveProvider } from './llm/api-registry.js';
import { InferenceEngine } from './llm/engine.js';
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

// ---- reason: 纯函数, 封装 LLM 调用 + 流式收集 + 重试 ----

interface ReasonParams {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  signal?: AbortSignal;
  errorHandler?: ErrorHandler;
}

interface ReasonResult {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  reasoning?: string;
  usage: LanguageModelUsage;
  finishReason: string;
}

async function reason(
  params: ReasonParams,
  emit: (chunk: ProviderChunk) => void,
): Promise<ReasonResult> {
  const llmProvider = resolveProvider(params.provider);
  const engine = new InferenceEngine();
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await engine.infer({
        messages: params.messages,
        stream: llmProvider.stream({
          model: params.model,
          apiKey: params.apiKey,
          baseURL: params.baseURL,
          system: params.system,
          messages: params.messages,
          tools: params.tools,
          signal: params.signal,
        }),
        onChunk: (chunk: StreamChunk) => {
          if (chunk.type === 'text') {
            emit({ type: 'text-delta', step: 0, text: chunk.text });
          } else if (chunk.type === 'reasoning') {
            emit({ type: 'reasoning-delta', step: 0, text: chunk.text });
          } else if (chunk.type === 'tool-call') {
            emit({ type: 'tool-call', step: 0, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input });
          }
        },
      });

      return {
        text: result.text,
        toolCalls: result.toolCalls,
        reasoning: result.reasoning,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        },
        finishReason: result.finishReason ?? 'stop',
      };
    } catch (error) {
      lastError = error;
      if (!params.errorHandler) throw error;
      const category = params.errorHandler.classify(error);
      if (!params.errorHandler.isRetryable(category)) throw error;
      if (attempt === maxAttempts - 1) throw error;
    }
  }

  throw lastError;
}

// ---- runAgent ----

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
      const skillProvider = pm.get<SkillProvider>('skill');
      const errorHandler = pm.require<ErrorHandler>('error');

      const { system, messages } = await contextProvider.build(session, behavior.name);

      let contextMessages = messages;
      if (compressor.shouldCompress(session)) {
        contextMessages = await compressor.compress(messages);
      }

      let systemWithSkills = system;
      if (skillProvider) {
        try {
          const skills = await skillProvider.loadSkills();
          const catalog = skillProvider.formatCatalog(skills);
          if (catalog) systemWithSkills = `${system}\n\n${catalog}`;
        } catch { /* best-effort */ }
      }

      const reasonCallback = async () => {
        return reason(
          {
            provider: modelConfig.provider,
            model: modelConfig.model,
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL,
            system: systemWithSkills,
            messages: contextMessages,
            tools: toolProvider.getToolSet(),
            signal: params.signal,
            errorHandler,
          },
          (chunk) => controller.emit(chunk),
        );
      };

      const approvalOrchestrator = pm.getApprovalOrchestrator();

      const executeCallback = async (toolCalls: ToolCall[]): Promise<ToolResult[]> => {
        const results: ToolResult[] = [];

        for (const tc of toolCalls) {
          const dangerous = toolProvider.isDangerous(tc.toolName);

          // 审批：runAgent 显式编排
          if (dangerous) {
            const decision = await approvalOrchestrator.requestApproval(
              {
                sessionId: params.sessionId,
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
                cwd: behavior.workspaceRoot,
                workspaceRoot: behavior.workspaceRoot,
                signal: params.signal,
                input: tc.input,
              } as any,
              {
                title: `Run ${tc.toolName}`,
                allowedDecisions: ['allow-once', 'deny'],
              },
              { emit: (chunk) => controller.emit(chunk) },
            );

            if (decision !== 'allow-once') {
              const errMsg = 'denied';
              controller.emit({
                type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output: '', error: errMsg,
              } as ProviderChunk);
              results.push({ toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: errMsg });
              continue;
            }
          }

          // 执行工具
          const [result] = await toolProvider.execute([tc], {
            cwd: behavior.workspaceRoot,
            workspaceRoot: behavior.workspaceRoot,
            signal: params.signal,
            agentName: behavior.name,
            readOnly: behavior.readOnly,
            sessionId: params.sessionId,
          });
          results.push(result);

          const output = result.error ?? result.output ?? '';
          controller.emit({
            type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output, error: result.error,
          } as ProviderChunk);

          session.conversation.push({
            id: generateId(), role: 'tool',
            content: [{ type: 'tool-result', toolCallId: tc.toolCallId, toolName: tc.toolName, output }],
          });
        }

        return results;
      };

      const loopCtx: LoopContext = {
        session, liveState,
        system: systemWithSkills, messages: contextMessages,
        reason: reasonCallback, execute: executeCallback,
        emit: (chunk) => controller.emit(chunk),
        signal: params.signal, maxSteps: behavior.maxTurns,
        workspaceRoot: behavior.workspaceRoot, readOnly: behavior.readOnly,
        agentName: behavior.name, sessionId: params.sessionId,
      };

      const result = await loopStrategy.run(loopCtx);

      for (const msg of result.newMessages) {
        if (!session.conversation.includes(msg)) session.conversation.push(msg);
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
  session: Session, pm: ProviderManager,
  controller: AgentStreamController, sessionProvider: SessionProvider,
): void {
  const titleProvider = pm.get<TitleProvider>('title');
  const modelConfig = pm.getModelConfig();
  if (!titleProvider || session.metadata.title) return;

  (async () => {
    try {
      const title = await titleProvider.generateTitle(session.conversation, {
        provider: modelConfig.provider,
        providerConfig: { model: modelConfig.model, apiKey: modelConfig.apiKey, baseURL: modelConfig.baseURL },
      });
      if (title) {
        session.metadata.title = title;
        controller.pushTitle(title);
        await sessionProvider.save(session);
      }
    } catch { /* best-effort */ }
  })();
}
