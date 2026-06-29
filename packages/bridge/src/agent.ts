import type { AgentStreamChunk, RunAgentResult } from 'rem-agent-core';
import {
  runAgent as coreRunAgent,
  createProviderManager,
  LocalSessionProvider,
  InMemoryToolProvider,
  SimpleMemoryProvider,
  FileSkillProvider,
  NoOpCompressor,
  SimpleErrorHandler,
  FixedBudgetPolicy,
} from 'rem-agent-core';
import type { ServerMessage } from 'rem-agent-core';
import { resolve } from 'path';
import { ServiceError } from './errors.js';

export type { ServerMessage } from 'rem-agent-core';

export interface RunParams {
  sessionId: string;
  content: string;
}

export interface RunResult {
  sessionId: string;
}

export interface InterruptResult {
  sessionId: string;
  interrupted: boolean;
}

export interface ResetResult {
  sessionId: string;
  reset: boolean;
}

interface SessionMessages {
  messages: ServerMessage[];
  assistantMsgId: string;
}

const g = globalThis as unknown as {
  _remBridgeAgentService?: AgentService;
};

export class AgentService {
  private activeRuns = new Map<string, AbortController>();
  private activeStreams = new Map<string, RunAgentResult>();
  private sessionProvider: LocalSessionProvider;
  private msgCache = new Map<string, SessionMessages>();
  private _pmReady = false;

  constructor() {
    this.sessionProvider = new LocalSessionProvider(resolve(process.cwd(), '.sessions'));
  }

  static getInstance(): AgentService {
    if (!g._remBridgeAgentService) {
      g._remBridgeAgentService = new AgentService();
    }
    return g._remBridgeAgentService;
  }

  private async ensureProviderManager(): Promise<void> {
    if (this._pmReady) return;
    await createProviderManager({
      configProvider: {
        getConfig: () => ({
          name: 'Rem Agent', maxTurns: 60, workspaceRoot: process.cwd(), readOnly: false,
          sessionsDir: resolve(process.cwd(), '.sessions'), skillsDir: resolve(process.cwd(), '.skills'),
          toolPolicy: undefined, model: { provider: 'openai', model: '', apiKey: '', baseURL: undefined },
        }),
        getBehaviorConfig: () => ({
          name: 'Rem Agent', maxTurns: 60, workspaceRoot: process.cwd(), readOnly: false,
          sessionsDir: resolve(process.cwd(), '.sessions'), skillsDir: resolve(process.cwd(), '.skills'),
        }),
        getModelConfig: () => ({ provider: 'openai', model: '', apiKey: '', baseURL: undefined }),
        getToolConfig: () => ({ policy: undefined }),
      } as import('rem-agent-core').ConfigProvider,
      sessionProvider: this.sessionProvider,
      toolProvider: new InMemoryToolProvider(),
      memoryProvider: new SimpleMemoryProvider('Rem Agent'),
      skillProvider: new FileSkillProvider(),
      compressor: new NoOpCompressor(),
      errorHandler: new SimpleErrorHandler(),
      budgetPolicy: new FixedBudgetPolicy({ maxTurns: 60 }),
    });
    this._pmReady = true;
  }

  /* ---- Agent lifecycle ---- */

  async run(params: RunParams): Promise<RunResult> {
    await this.ensureProviderManager();

    if (this.activeRuns.has(params.sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    const abortController = new AbortController();
    this.activeRuns.set(params.sessionId, abortController);

    const result = coreRunAgent({
      input: { content: params.content, timestamp: new Date() },
      sessionId: params.sessionId,
      signal: abortController.signal,
    });

    this.activeStreams.set(params.sessionId, result);

    result.output.finally(() => {
      this.activeRuns.delete(params.sessionId);
      this.activeStreams.delete(params.sessionId);
    });

    return { sessionId: params.sessionId };
  }

  interrupt(sessionId: string): InterruptResult {
    const controller = this.activeRuns.get(sessionId);
    if (controller) {
      controller.abort();
    }
    return { sessionId, interrupted: !!controller };
  }

  getStream(sessionId: string): RunAgentResult | undefined {
    return this.activeStreams.get(sessionId);
  }

  /* ---- Message tracking ---- */

  addUserMessage(sessionId: string, content: string): void {
    let entry = this.msgCache.get(sessionId);
    if (!entry) {
      entry = { messages: [], assistantMsgId: '' };
      this.msgCache.set(sessionId, entry);
    }
    entry.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content,
      toolCalls: [],
      status: 'done',
    });
    const assistId = crypto.randomUUID();
    entry.assistantMsgId = assistId;
    entry.messages.push({
      id: assistId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      status: 'pending',
    });
  }

  applyChunk(sessionId: string, chunk: AgentStreamChunk): void {
    const entry = this.msgCache.get(sessionId);
    if (!entry) return;
    const msg = entry.messages.find((m) => m.id === entry.assistantMsgId);
    if (!msg) return;

    if (chunk.type === 'text-delta') {
      msg.content += chunk.text;
      msg.status = 'streaming';
    } else if (chunk.type === 'reasoning-delta') {
      msg.reasoning = (msg.reasoning ?? '') + chunk.text;
      msg.status = 'streaming';
    } else if (chunk.type === 'tool-call-start') {
      msg.toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, arguments: {} });
      msg.status = 'streaming';
    } else if (chunk.type === 'tool-call') {
      const tc = msg.toolCalls.find((t: { id: string }) => t.id === chunk.toolCallId);
      if (tc) tc.arguments = (chunk.input as Record<string, unknown>) ?? {};
    } else if (chunk.type === 'tool-result') {
      const tc = msg.toolCalls.find((t: { id: string }) => t.id === chunk.toolCallId);
      if (tc) {
        tc.result = { success: !chunk.error, output: chunk.output, error: chunk.error, durationMs: 0 };
      }
    } else if (chunk.type === 'finish') {
      msg.status = 'done';
      this.sessionProvider.cueMessages(sessionId, entry.messages);
    } else if (chunk.type === 'error') {
      msg.status = 'error';
      msg.error = String(chunk.error);
      this.sessionProvider.cueMessages(sessionId, entry.messages);
    }
  }

  getMessages(sessionId: string): ServerMessage[] {
    const entry = this.msgCache.get(sessionId);
    if (entry?.messages.length) return entry.messages;
    return this.sessionProvider.pullMessages(sessionId);
  }
}
