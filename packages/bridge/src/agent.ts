import type { AgentStreamChunk, ProviderManager, SessionProvider, ApprovalDecision, ApprovalRequest, AgentLiveProvider } from 'rem-agent-core';
import { runAgent as coreRunAgent, ApprovalRegistry } from 'rem-agent-core';
import { ServiceError } from './errors.js';
import { bus } from './broadcast-bus.js';
import { runRegistry } from './run-registry.js';
import type { BusEvent, SessionActivity, SessionSummary, SessionUpdate, UIMessage } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import { AgentSessionManager } from './agent-session.js';
import { SessionActivityTracker } from './session-activity-tracker.js';
import { streamingSnapshots } from './streaming-snapshots.js';
import { reduceStreamChunk } from './stream-reducer.js';

export class AgentService implements IAgentService {
  private sessionProvider: SessionProvider;
  private workspace: string;
  private sessionManager: AgentSessionManager;
  private activityTracker: SessionActivityTracker;
  private approvalRegistry = new ApprovalRegistry();

  constructor(private providerManager: ProviderManager, workspace = 'default') {
    this.sessionProvider = providerManager.require<SessionProvider>('session');
    this.workspace = workspace;
    this.sessionManager = new AgentSessionManager(this.sessionProvider);
    this.activityTracker = new SessionActivityTracker((sessionId, activity) => {
      bus.publish({
        workspace: this.workspace,
        sessionId,
        type: 'activity-change',
        activity,
      });
    });
  }

  /* ---- Agent lifecycle ---- */

  async run(sessionId: string, input: string): Promise<void> {
    const abortController = new AbortController();
    if (!runRegistry.register(sessionId, abortController)) {
      throw new ServiceError('Session is already running', 409);
    }

    bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });
    this.activityTracker.start(sessionId);

    let result: ReturnType<typeof coreRunAgent>;
    try {
      result = coreRunAgent({
        input: { content: input, timestamp: new Date() },
        sessionId,
        signal: abortController.signal,
        pm: this.providerManager,
        approvalRegistry: this.approvalRegistry,
      });
    } catch (err) {
      bus.publish({ workspace: this.workspace, sessionId, type: 'session-error', error: err instanceof Error ? err.message : String(err) });
      runRegistry.remove(sessionId);
      this.activityTracker.finish(sessionId);
      throw err;
    }

    // Background self-driven consumption: independent of any client connection.
    void this.drive(sessionId, result);
  }

  private async drive(sessionId: string, result: ReturnType<typeof coreRunAgent>): Promise<void> {
    const workspace = this.workspace;

    const consume = (async () => {
      for await (const chunk of result.stream.fullStream) {
        this.activityTracker.applyChunk(sessionId, chunk);

        if (chunk.type === 'message-start') {
          streamingSnapshots.start(sessionId, chunk.messageId);
        } else if (isContentChunk(chunk)) {
          const entry = streamingSnapshots.get(sessionId);
          if (entry) {
            try {
              streamingSnapshots.update(sessionId, reduceStreamChunk(entry.parts, chunk));
            } catch {
              // snapshot best-effort
            }
          }
        }

        bus.publish({ workspace, sessionId, type: 'chunk', chunk });

        if (chunk.type === 'finish') {
          streamingSnapshots.clear(sessionId);
          bus.publish({ workspace, sessionId, type: 'session-end' });
        }
        if (chunk.type === 'error') {
          streamingSnapshots.clear(sessionId);
          bus.publish({ workspace, sessionId, type: 'session-error', error: String(chunk.error) });
        }
      }
    })();

    const outputGuard = result.output.then(
      () => new Promise<never>(() => {}),
      (err) => { throw err instanceof Error ? err : new Error(String(err)); },
    );

    try {
      await Promise.race([consume, outputGuard]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      streamingSnapshots.clear(sessionId);
      bus.publish({ workspace, sessionId, type: 'session-error', error: message });
    } finally {
      runRegistry.remove(sessionId);
      streamingSnapshots.clear(sessionId);
      this.activityTracker.finish(sessionId);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    runRegistry.abort(sessionId);
  }

  async reset(sessionId: string): Promise<void> {
    runRegistry.abort(sessionId);
    runRegistry.remove(sessionId);
  }

  /* ---- Message tracking ---- */

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    return this.sessionManager.getMessages(sessionId);
  }

  async createSession(): Promise<SessionSummary> {
    return this.sessionManager.createSession();
  }

  async listSessions(): Promise<SessionSummary[]> {
    const list = await this.sessionManager.listSessions();
    return list.map((s) => ({
      ...s,
      activity: this.activityTracker.get(s.sessionId) ?? 'idle',
    }));
  }

  async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
    return this.sessionManager.updateSession(sessionId, updates);
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.sessionManager.deleteSession(sessionId);
  }

  /* ---- Approval ---- */

  async listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
    const liveProvider = this.providerManager.get<AgentLiveProvider>('state');
    if (!liveProvider) return [];
    const liveState = await liveProvider.get(sessionId);
    return liveState?.pendingApprovals ?? [];
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    return this.approvalRegistry.resolve(approvalId, decision);
  }

  /* ---- Broadcast stream ---- */

  async *stream(): AsyncIterable<BusEvent> {
    const queue: BusEvent[] = [];
    let resolveNext: ((event: BusEvent) => void) | null = null;

    const unsub = bus.subscribe((event) => {
      if (event.workspace !== this.workspace) return;
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        queue.push(event);
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<BusEvent>((r) => { resolveNext = r; });
        }
      }
    } finally {
      unsub();
    }
  }
}

function isContentChunk(chunk: AgentStreamChunk): boolean {
  return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' ||
    chunk.type === 'tool-call' || chunk.type === 'tool-result' ||
    chunk.type === 'text-start' || chunk.type === 'reasoning-start' ||
    chunk.type === 'tool-call-start' || chunk.type === 'tool-result-start';
}
