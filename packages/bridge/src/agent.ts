import type { AgentStreamChunk, ProviderManager, SessionProvider, ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import { runAgent as coreRunAgent } from 'rem-agent-core';
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

    console.log(`[Agent] run start session=${sessionId} input="${input.slice(0, 50)}"`);

    bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });
    this.activityTracker.start(sessionId);

    let result: ReturnType<typeof coreRunAgent>;
    try {
      result = coreRunAgent({
        input: { content: input, timestamp: new Date() },
        sessionId,
        signal: abortController.signal,
        pm: this.providerManager,
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
    console.log(`[resume] driver start session=${sessionId}`);

    const consume = (async () => {
      for await (const chunk of result.stream.fullStream) {
        this.activityTracker.applyChunk(sessionId, chunk);

        if (chunk.type === 'message-start') {
          streamingSnapshots.start(sessionId, chunk.messageId);
          console.log(`[resume] snapshot start session=${sessionId} messageId=${chunk.messageId}`);
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
      console.log(`[resume] driver error session=${sessionId} error=${message}`);
      streamingSnapshots.clear(sessionId);
      bus.publish({ workspace, sessionId, type: 'session-error', error: message });
    } finally {
      console.log(`[resume] driver end session=${sessionId}`);
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
    return this.providerManager.getApprovalOrchestrator().listPending(sessionId);
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    return this.providerManager.getApprovalOrchestrator().resolveApproval(approvalId, decision);
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
      // Push current snapshots to this new subscriber.
      // subscribe() above and this read happen synchronously with no await between,
      // so no chunk can be processed in between: snapshot + queued chunks are gap-free.
      const runningIds = streamingSnapshots.runningSessionIds();
      console.log(`[resume] new stream subscriber workspace=${this.workspace} runningSessions=[${runningIds.join(',')}]`);
      const snapshotEvents: BusEvent[] = [];
      for (const sessionId of runningIds) {
        const entry = streamingSnapshots.get(sessionId);
        if (entry && entry.parts.length > 0) {
          snapshotEvents.push({
            workspace: this.workspace,
            sessionId,
            type: 'snapshot',
            messageId: entry.messageId,
            parts: entry.parts,
          });
        } else {
          console.log(`[resume] skip snapshot push session=${sessionId} reason=${entry ? 'emptyParts' : 'noEntry'}`);
        }
      }
      for (const ev of snapshotEvents) {
        const snap = ev as Extract<BusEvent, { type: 'snapshot' }>;
        console.log(`[resume] push snapshot session=${snap.sessionId} messageId=${snap.messageId} parts=${snap.parts.length}`);
        yield ev;
      }

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
