import {
  runAgent as coreRunAgent,
  ProviderManager,
  LocalSessionProvider,
  InMemoryToolProvider,
  SimpleMemoryProvider,
  FileSkillProvider,
  NoOpCompressor,
  SimpleErrorHandler,
  FixedBudgetPolicy,
} from 'rem-agent-core';
import type { AgentStreamChunk, RunAgentResult } from 'rem-agent-core';
import { resolve } from 'path';

export interface ServerMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: { success: boolean; output: string; error?: string; durationMs: number };
  }>;
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
}

interface SessionMessages {
  messages: ServerMessage[];
  assistantMsgId: string;
}

const g = globalThis as unknown as {
  _remAgentService?: AgentService;
};

export class AgentService {
  private activeRuns = new Map<string, AbortController>();
  private activeStreams = new Map<string, RunAgentResult>();
  private sessionProvider: LocalSessionProvider;
  private msgCache = new Map<string, SessionMessages>();

  constructor() {
    this.sessionProvider = new LocalSessionProvider(resolve(process.cwd(), '.sessions'));
  }

  static getInstance(): AgentService {
    if (!g._remAgentService) {
      g._remAgentService = new AgentService();
    }
    return g._remAgentService;
  }

  private async ensureProviderManager(): Promise<void> {
    if ((ProviderManager as unknown as { _init?: boolean })._init) return;
    ProviderManager.resetInstance();
    await ProviderManager.getInstance({
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
  }

  async run(sessionId: string, content: string) {
    await this.ensureProviderManager();

    if (this.activeRuns.has(sessionId)) {
      throw new Error('Session is already running');
    }

    const abort = new AbortController();
    this.activeRuns.set(sessionId, abort);

    const result = coreRunAgent({
      input: { content, timestamp: new Date() },
      sessionId,
      signal: abort.signal,
    });

    this.activeStreams.set(sessionId, result);

    result.output.finally(() => {
      this.activeRuns.delete(sessionId);
      this.activeStreams.delete(sessionId);
    });

    return result;
  }

  interrupt(sessionId: string): boolean {
    const controller = this.activeRuns.get(sessionId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  getStream(sessionId: string): RunAgentResult | undefined {
    return this.activeStreams.get(sessionId);
  }

  /* ---- Message cache ---- */

  addUserMessage(sessionId: string, content: string) {
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

  applyChunk(sessionId: string, chunk: AgentStreamChunk) {
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
      const tc = msg.toolCalls.find((t) => t.id === chunk.toolCallId);
      if (tc) tc.arguments = (chunk.input as Record<string, unknown>) ?? {};
    } else if (chunk.type === 'tool-result') {
      const tc = msg.toolCalls.find((t) => t.id === chunk.toolCallId);
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
    return (this.sessionProvider.pullMessages(sessionId) ?? []) as ServerMessage[];
  }
}
