import type { Models, Message } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { RunLiveSignalDraft } from '../domain/event/live-signals.js';
import type { AgentRun } from '../domain/run/types.js';
import type { AgentSession } from '../domain/session/types.js';
import type { AgentDefinitionProvider } from '../sdk/agent-definition-provider.js';
import type { RuntimeConfigProvider } from '../sdk/runtime-config-provider.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../plugin-system/runtime-plugin-host.js';
import { StaticToolProvider } from '../plugins/tool/static/index.js';
import { normalizeRuntimeToolContribution } from '../application/contexts/runtime-tool-definition.js';
import { RecordingToolProvider } from './recording-tool-provider.js';
import { LinkedAbortController } from './linked-abort-controller.js';
import { ToolFatalState } from './tool-fatal-state.js';
import { resolveRunConfig } from './runtime-agent-config.js';
import { selectRuntimeTools } from './runtime-tool-selection.js';
import { createSubmitResultTool } from './submit-result-tool.js';
import type { RunExecutionResult, RunExecutor } from './run-executor.js';
import { RunLiveSignalProjector, type RunLiveSignalProjectorState } from './run-live-signal-projector.js';
import { appendRunExecutionMessage } from './run-execution-journal.js';
import { createRuntimeDelegateTaskTool } from './runtime-delegate-tool.js';
import { createRuntimeSendMessageTool } from './runtime-send-message-tool.js';
import type { SingleAgentOrchestrationContext } from './single-agent-executor-orchestration.js';
import type { RuntimeToolContribution } from '../sdk/runtime-plugin.js';
import type { RuntimeObservationSink } from '../sdk/runtime-observer.js';
import { executeRuntimeChild } from './runtime-child-delegation.js';
import { assertNotAborted, assertRunSessionOwnership, signalSource } from './single-agent-executor-context.js';
import { loadRunDefinition, logModelFailure, readTriggerContent, resolveExecutionRoot, validateModelConfig } from './single-agent-executor-boundaries.js';
import { readNodeJournal } from './run-execution-journal-reader.js';
import { classifyNodeCheckpoint } from './run-execution-checkpoint.js';
import { restoreSubmittedResult } from './submit-result-recovery.js';
import { isModelError, isPersistableMessage } from './single-agent-executor-messages.js';
import { resumeCheckpointTools } from './single-agent-executor-resume.js';
import { observeModel } from './model-observation.js';
import { runSingleAgentModelTurn } from './single-agent-model-turn.js';
import { buildSingleAgentArtifacts } from './single-agent-artifacts.js';
export interface SingleAgentRunExecutorOptions {
  models: Models;
  config: RuntimeConfigProvider;
  executionRoot: string;
  agentDefinitions: AgentDefinitionProvider;
  storage: RuntimeStorage;
  pluginHost: RuntimePluginHost;
  observe?: RuntimeObservationSink;
}
export class SingleAgentRunExecutor implements RunExecutor {
  constructor(private readonly options: SingleAgentRunExecutorOptions) {}
  async execute(input: {
    run: AgentRun;
    session: AgentSession;
    signal: AbortSignal;
    definitionOverride?: AgentDefinition;
    delegationDepth?: number;
    emitSignal?: (signal: RunLiveSignalDraft) => void;
    transcriptEntries?: import('../domain/run/execution-models.js').RunExecutionEntry[];
    orchestration?: SingleAgentOrchestrationContext;
    maxTurnsOverride?: number;
    suppressUserMessagePersistence?: boolean;
    liveSignalState?: RunLiveSignalProjectorState;
    observe?: RuntimeObservationSink;
  }): Promise<RunExecutionResult> {
    const linked = new LinkedAbortController(input.signal);
    const fatal = new ToolFatalState(() => linked.controller.abort());
    const emitSignal = (signal: RunLiveSignalDraft): void => {
      if (!input.emitSignal) return;
      try { input.emitSignal(signal); } catch { /* observers cannot fail execution */ }
    };
    try {
      return await this._execute(input, linked.controller.signal, fatal, emitSignal);
    } catch (error) {
      if (fatal.error) throw fatal.error;
      if (input.signal.aborted) throw new RuntimeError('EXECUTION_CANCELLED', 'Run execution cancelled');
      throw error;
    } finally { linked.dispose(); }
  }
  private async _execute(
    input: { run: AgentRun; session: AgentSession; signal: AbortSignal; definitionOverride?: AgentDefinition; delegationDepth?: number; transcriptEntries?: import('../domain/run/execution-models.js').RunExecutionEntry[]; orchestration?: SingleAgentOrchestrationContext; maxTurnsOverride?: number; suppressUserMessagePersistence?: boolean; liveSignalState?: RunLiveSignalProjectorState; observe?: RuntimeObservationSink },
    signal: AbortSignal,
    fatal: ToolFatalState,
    emitSignal: (signal: RunLiveSignalDraft) => void,
  ): Promise<RunExecutionResult> {
    const { run, session } = input;
    assertNotAborted(signal);
    assertRunSessionOwnership(run, session);
    const definition = await loadRunDefinition(this.options.agentDefinitions, run, input.definitionOverride);
    assertNotAborted(signal);
    const checkpointData = await this.options.storage.transaction((uow) => {
      assertNotAborted(signal);
      const nodeId = run.rootNodeId ?? `${run.runId}:root`;
      const journal = readNodeJournal(uow, run.runId, nodeId);
      const projected = input.transcriptEntries === undefined ? journal : structuredClone(input.transcriptEntries);
      const invocations = uow.toolInvocations.listByRun(run.runId).filter((invocation) =>
        (invocation.nodeId ?? `${run.runId}:root`) === nodeId);
      return {
        entries: uow.sessions.listEntries(session.sessionId),
        journal: projected,
        invocations,
        checkpoint: classifyNodeCheckpoint(projected, invocations, nodeId),
      };
    });
    assertNotAborted(signal);
    const contributions = await this.options.pluginHost.materializeSnapshot(structuredClone(run.contextSnapshot));
    const tools = contributions.map((tool) => normalizeRuntimeToolContribution(tool));
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.definition.name)) throw new RuntimeError('CONTEXT_CONFLICT', `Tool already contributed: ${tool.definition.name}`);
      names.add(tool.definition.name);
    }
    const resolvedConfig = resolveRunConfig(this.options.config, definition, run);
    validateModelConfig(run, resolvedConfig.model);
    const selectedTools = selectRuntimeTools(tools, definition.toolNames, resolvedConfig.behavior, resolvedConfig.tool, resolvedConfig.model.provider);
    const provider = new StaticToolProvider(selectedTools);
    let submittedResult = restoreSubmittedResult(definition, checkpointData.invocations);
    if (definition.outputSchema !== undefined) {
      const submit = createSubmitResultTool(definition, (result) => { submittedResult = result; }, input.orchestration?.canSubmitResult);
      provider.register(submit.definition, submit.executor);
      selectedTools.push({ definition: submit.definition, executor: submit.executor });
    }
    if (input.orchestration !== undefined) {
      const send = createRuntimeSendMessageTool(input.orchestration);
      provider.register(send.definition, send.executor);
      selectedTools.push(send as unknown as RuntimeToolContribution);
    }
    const delegationDepth = input.delegationDepth ?? 0;
    if (definition.execution.type === 'single-agent' && definition.execution.delegation?.enabled
      && delegationDepth < Math.min(definition.execution.delegation.maxDepth ?? 3, run.executionPlanSnapshot?.limits.maxDepth ?? 3)) {
      const delegate = createRuntimeDelegateTaskTool((childInput, context) => executeRuntimeChild({
        storage: this.options.storage, parentRun: run, session, definition, input: childInput, context,
        depth: delegationDepth, emitSignal, execute: (child) => this.execute(child),
      }));
      provider.register(delegate.definition, delegate.executor);
      selectedTools.push(delegate as unknown as RuntimeToolContribution);
    }
    const recording = new RecordingToolProvider({
      storage: this.options.storage, provider, run: structuredClone(run),
      allowedToolNames: selectedTools.map((tool) => tool.definition.name), fatalState: fatal, observe: input.observe ?? this.options.observe,
    });
    const executionRoot = resolveExecutionRoot(run, this.options.executionRoot);
    const messages: Message[] = [
      ...(input.transcriptEntries === undefined ? checkpointData.entries.map((entry) => entry.message) : []),
      ...checkpointData.checkpoint.transcript,
    ].filter((message): message is Message => message !== undefined).map((message) => structuredClone(message));
    const sessionEntries: RunExecutionResult['sessionEntries'] = [];
    let journaled = false;
    let modelError: string | undefined;
    const projector = new RunLiveSignalProjector(emitSignal, signalSource(run), input.liveSignalState);
    const handleEvent = async (event: AgentEvent): Promise<void> => {
      projector.ingest(event);
      if (event.type !== 'message_end' || !isPersistableMessage(event.message)) {
        if (event.type === 'message_end' && isModelError(event.message)) modelError = event.message.errorMessage;
        return;
      }
      const message = structuredClone(event.message);
      if (message.role === 'user' && input.suppressUserMessagePersistence) return;
      sessionEntries.push({ message });
      if (run.executionPlanSnapshot !== undefined) {
        await appendRunExecutionMessage(this.options.storage, run, message, new Date());
        journaled = true;
      }
    };
    const loopContext = {
      cwd: executionRoot, executionRoot, sessionId: session.sessionId, tenantId: run.tenantId,
      principalId: run.principalId, runId: run.runId, agentName: resolvedConfig.behavior.name,
      readOnly: resolvedConfig.behavior.readOnly,
    };
    await resumeCheckpointTools(checkpointData.checkpoint, messages, recording, loopContext, signal, handleEvent);
    let lastAssistant = checkpointData.checkpoint.kind === 'completed' ? checkpointData.checkpoint.finalMessage : undefined;
    if (checkpointData.checkpoint.kind !== 'completed') {
      const initialTeamPrompt = input.transcriptEntries !== undefined && checkpointData.checkpoint.kind === 'continue' && !checkpointData.checkpoint.transcript.some((message) => message.role === 'assistant' || message.role === 'toolResult');
      lastAssistant = await runSingleAgentModelTurn({
        run, definition, model: resolvedConfig.model, messages,
        userMessage: input.transcriptEntries === undefined
          ? { role: 'user', content: readTriggerContent(run), timestamp: Date.now() } as Message
          : initialTeamPrompt ? undefined
          : { role: 'user', content: 'Process the latest Team delivery and respond.', timestamp: Date.now() } as Message,
        agentName: resolvedConfig.behavior.name, readOnly: resolvedConfig.behavior.readOnly,
        resume: input.transcriptEntries === undefined && checkpointData.checkpoint.kind !== 'start', models: this.options.models,
        toolProvider: recording, sessionId: session.sessionId, executionRoot,
        maxTurns: input.maxTurnsOverride ?? resolvedConfig.behavior.maxTurns, signal, onEvent: handleEvent,
        observe: input.observe ?? this.options.observe,
      });
    }
    fatal.assertHealthy();
    assertNotAborted(signal);
    if (modelError) {
      if (!isModelError(lastAssistant)) observeModel(input.observe ?? this.options.observe, 'failed', run, resolvedConfig.model, Date.now(), undefined, 'MODEL_EXECUTION_FAILED', modelError);
      logModelFailure(run, resolvedConfig.model, modelError);
      throw new RuntimeError('MODEL_EXECUTION_FAILED', 'Model execution failed', false, undefined, { cause: new Error(modelError) });
    }
    const finalizable = input.orchestration === undefined ? true : await input.orchestration.canSubmitResult();
    const intermediate = input.orchestration?.allowIntermediate === true
      && (!input.orchestration.requiresFinal || !finalizable);
    const artifacts = buildSingleAgentArtifacts(definition, lastAssistant, submittedResult, intermediate);
    if (!artifacts.length && !intermediate) throw new RuntimeError('MODEL_EXECUTION_FAILED', 'Model execution did not produce a result');
    return { sessionEntries, artifacts, journaled: journaled || checkpointData.checkpoint.kind === 'completed' || checkpointData.journal.length > 0 };
  }
}
