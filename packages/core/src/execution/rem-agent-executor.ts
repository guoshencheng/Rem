import type { REMAgentEvent } from '../agent/agent-event.js';
import type { UserInputContent } from '../agent/types.js';
import type { AgentAssembly } from '../assembly/types.js';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { ArtifactDraft } from '../domain/artifact/types.js';
import type { AgentRun } from '../domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry } from '../domain/session/types.js';
import type { AgentDefinitionProvider } from '../sdk/agent-definition-provider.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import { REMAgent } from '../agent/rem-agent.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { normalizeAgentDefinition } from '../application/runs/normalize-agent-definition.js';
import { RuntimePluginHost } from '../plugin-system/runtime-plugin-host.js';
import { StaticToolProvider } from '../plugins/tool/static/index.js';
import { RecordingToolProvider } from './recording-tool-provider.js';
import { normalizeRuntimeToolContribution } from '../application/contexts/runtime-tool-definition.js';
import { isUserMessageContent } from '../domain/run/message-trigger-content.js';
import { LinkedAbortController } from './linked-abort-controller.js';
import { NoOpRuntimeCompressor } from './noop-runtime-compressor.js';
import { ToolFatalState } from './tool-fatal-state.js';
import type { RunExecutionResult, RunExecutor } from './run-executor.js';

export interface REMAgentRunExecutorOptions {
  assembly: AgentAssembly;
  agentDefinitions: AgentDefinitionProvider;
  storage: RuntimeStorage;
  pluginHost: RuntimePluginHost;
}

/** Bridges immutable Runtime runs to the legacy REMAgent loop without sharing mutable DI. */
export class REMAgentRunExecutor implements RunExecutor {
  constructor(private readonly options: REMAgentRunExecutorOptions) {}

  async execute(input: { run: AgentRun; session: AgentSession; signal: AbortSignal }): Promise<RunExecutionResult> {
    const linked = new LinkedAbortController(input.signal);
    const fatal = new ToolFatalState(() => linked.controller.abort());
    try { return await this._execute(input.run, input.session, linked.controller.signal, fatal); }
    catch (error) {
      if (fatal.error) throw fatal.error;
      if (input.signal.aborted) throw new RuntimeError('EXECUTION_CANCELLED', 'Run execution cancelled');
      throw error;
    } finally { linked.dispose(); }
  }

  private async _execute(run: AgentRun, session: AgentSession, signal: AbortSignal, fatal: ToolFatalState): Promise<RunExecutionResult> {
    assertNotAborted(signal);
    this._validateOwnership(run, session);
    const definition = await this._loadDefinition(run);
    assertNotAborted(signal);
    const entries = await this.options.storage.transaction((uow) => {
      assertNotAborted(signal);
      return uow.sessions.listEntries(session.sessionId);
    });
    assertNotAborted(signal);
    const tools = await this.options.pluginHost.materializeSnapshot(structuredClone(run.contextSnapshot));
    assertNotAborted(signal);
    const normalizedTools = tools.map((tool) => normalizeRuntimeToolContribution(tool));
    const toolNames = new Set<string>();
    for (const tool of normalizedTools) {
      if (toolNames.has(tool.definition.name)) throw new RuntimeError('CONTEXT_CONFLICT', `Tool already contributed: ${tool.definition.name}`);
      toolNames.add(tool.definition.name);
    }
    const provider = new StaticToolProvider(normalizedTools);
    const recording = new RecordingToolProvider({
      storage: this.options.storage, provider, run: structuredClone(run),
      allowedToolNames: definition.toolNames, fatalState: fatal,
    });
    const systemPrompt = this._systemPrompt(definition, run);
    const executionRoot = this._executionRoot(run);
    const configProvider = this._configProvider(definition);
    assertNotAborted(signal);
    const agent = new REMAgent({
      agentId: run.agentId, sessionId: session.sessionId,
      di: { ...this.options.assembly.di, configProvider, toolProvider: recording, compressor: new NoOpRuntimeCompressor() },
      runtimeConfig: this.options.assembly.runtimeConfig,
      session: this._legacySession(session, entries),
      workspace: executionRoot, workspaceRoot: executionRoot, systemPrompt,
      toolCapabilities: { readSkill: false, delegateTask: false, todoWrite: false }, signal,
    });
    const sessionEntries: RunExecutionResult['sessionEntries'] = [];
    let artifact: ArtifactDraft | undefined;
    let modelError: string | undefined;
    assertNotAborted(signal);
    for await (const event of agent.run({ content: this._triggerContent(run) })) {
      if (event.type === 'message-persist') {
        sessionEntries.push({ message: structuredClone(event.message) });
      } else if (event.type === 'finish') {
        artifact = { type: 'result', mediaType: 'text/plain', name: 'result.txt', data: event.output.content };
      } else if (event.type === 'error') {
        modelError = event.error.message;
      }
    }
    fatal.assertHealthy();
    if (signal.aborted) throw new RuntimeError('EXECUTION_CANCELLED', 'Run execution cancelled');
    if (modelError) throw new RuntimeError('MODEL_EXECUTION_FAILED', 'Model execution failed', false, undefined, {
      cause: new Error(modelError),
    });
    if (!artifact) throw new RuntimeError('MODEL_EXECUTION_FAILED', 'Model execution did not produce a result');
    return { sessionEntries, artifacts: [artifact] };
  }

  private async _loadDefinition(run: AgentRun): Promise<AgentDefinition> {
    let received: AgentDefinition | null;
    try { received = await this.options.agentDefinitions.get(run.agentId, run.agentRevision); }
    catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError('AGENT_REVISION_NOT_FOUND', 'Agent definition revision is unavailable', false, undefined, { cause: error });
    }
    if (!received) throw new RuntimeError('AGENT_REVISION_NOT_FOUND', 'Agent definition revision is unavailable');
    const definition = normalizeAgentDefinition(received, run.agentId, run.agentRevision);
    if (definition.agentId !== run.agentId || definition.revision !== run.agentRevision) {
      throw new RuntimeError('AGENT_REVISION_NOT_FOUND', 'Agent definition revision does not match the run');
    }
    return definition;
  }

  private _legacySession(session: AgentSession, entries: RuntimeSessionEntry[]) {
    const conversation = entries.slice().sort((left, right) => left.sequence - right.sequence)
      .map((entry) => structuredClone(entry.message));
    return { sessionId: session.sessionId, conversation, currentTurn: 0,
      // Runtime owns naming/projection; suppress the legacy background title-model side effect.
      metadata: { schemaVersion: 2, title: 'Runtime session' },
      createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt) };
  }

  private _systemPrompt(definition: AgentDefinition, run: AgentRun): string {
    const sections = run.contextSnapshot.promptSections.slice().sort(
      (left, right) => left.priority - right.priority || left.name.localeCompare(right.name),
    );
    return [definition.instructions, ...sections.map((section) => section.content)].filter(Boolean).join('\n\n');
  }

  private _configProvider(definition: AgentDefinition): ConfigProvider {
    const base = this.options.assembly.di.configProvider;
    const model = resolveRuntimeModel(base, definition.modelId);
    const compression = { ...base.getCompressionConfig(), enabled: false };
    const behavior = { ...base.getBehaviorConfig(), compression };
    let scoped!: ConfigProvider;
    scoped = new Proxy(base, {
      get(target, property) {
        if (property === 'resolveAgent') return () => ({
          id: definition.agentId, name: definition.name, corePrompt: definition.instructions,
          model,
        });
        if (property === 'getCompressionConfig') return () => ({ ...compression });
        if (property === 'getBehaviorConfig') return () => ({ ...behavior, compression: { ...compression } });
        if (property === 'getConfig') return () => ({ ...behavior, compression: { ...compression },
          policy: target.getToolConfig().policy, model });
        // The persisted snapshot, not a mutable filesystem scope, defines this run.
        if (property === 'forWorkspace') return () => scoped;
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return scoped;
  }

  private _executionRoot(run: AgentRun): string {
    for (const item of run.contextSnapshot.items) {
      const snapshot = item.snapshot;
      if (isRecord(snapshot) && typeof snapshot.executionRoot === 'string' && snapshot.executionRoot.trim()) {
        return snapshot.executionRoot;
      }
    }
    return process.cwd();
  }

  private _triggerContent(run: AgentRun): UserInputContent {
    if (run.trigger.type === 'message') {
      const content = structuredClone(run.trigger.content);
      if (isUserMessageContent(content)) return content as UserInputContent;
      throw new RuntimeError('INVALID_INPUT', 'Message trigger content is not valid user input');
    }
    try { return JSON.stringify(run.trigger.input); }
    catch (error) { throw new RuntimeError('INVALID_INPUT', 'Task input is not serializable', false, undefined, { cause: error }); }
  }

  private _validateOwnership(run: AgentRun, session: AgentSession): void {
    if (run.sessionId !== session.sessionId || run.tenantId !== session.tenantId) {
      throw new RuntimeError('RUN_CONFLICT', 'Run and session ownership do not match');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new RuntimeError('EXECUTION_CANCELLED', 'Run execution cancelled');
}

function resolveRuntimeModel(provider: ConfigProvider, modelId: string) {
  try { return provider.getModelConfig(modelId); }
  catch (cause) { throw new RuntimeError('MODEL_UNAVAILABLE', 'Configured model is unavailable', false, undefined, { cause }); }
}
