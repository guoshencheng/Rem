import type { Message } from '@earendil-works/pi-ai';
import { runAgentLoop, runAgentLoopContinue } from '@earendil-works/pi-agent-core';
import type { AgentContext, AgentEvent } from '@earendil-works/pi-agent-core';
import { AgentRunState } from './agent-run-state.js';
import { forkSessionTitleGeneration } from './session-title.js';
import type { REMAgentEvent } from './agent-event.js';
import type { REMAgentParams, REMAgentStatus } from './rem-agent-params.js';
import type { AgentOutput, RemMetaEvent, UserInput, UserInputContent } from './types.js';
import { assembleAgentLoop, type AssembledAgentLoop } from '../runtime/agent-loop-assembler.js';
import { emitLoopFailure } from '../runtime/loop-failure.js';
import { PendingMessageQueue } from '../runtime/pending-queue.js';

export type { REMAgentParams, REMAgentStatus } from './rem-agent-params.js';

const toMessage = (content: UserInputContent): Message =>
  ({ role: 'user', content, timestamp: Date.now() }) as Message;

/** 自持 transcript、控制队列与 abort，并直接驱动 pi-agent-core 无状态循环。 */
export class REMAgent {
  readonly agentId: string;
  readonly sessionId?: string;
  readonly summary?: string;
  status: REMAgentStatus = 'idle';

  private readonly params: REMAgentParams;
  private messages: Message[];
  private steeringQueue = new PendingMessageQueue('all');
  private followUpQueue = new PendingMessageQueue('one-at-a-time');
  private activeAbort?: AbortController;
  private turns = 0;
  private runState?: AgentRunState;
  private pendingMeta: RemMetaEvent[] = [];
  private initPromise?: Promise<AssembledAgentLoop>;
  private loop?: AssembledAgentLoop;

  constructor(params: REMAgentParams) {
    this.params = params;
    this.agentId = params.agentId;
    this.sessionId = params.sessionId;
    this.summary = params.summary;
    this.messages = params.session.conversation.slice();
    params.signal?.addEventListener('abort', () => this.interrupt());
    forkSessionTitleGeneration({
      di: params.di,
      session: params.session,
      emit: (event) => this.emitMeta(event),
    });
  }

  get events(): AsyncIterable<REMAgentEvent> | undefined {
    return this.runState?.queue;
  }

  get output(): Promise<AgentOutput> | undefined {
    return this.runState?.outputPromise;
  }

  run(input: UserInput): AsyncIterable<REMAgentEvent> {
    const state = this.beginRun();
    void this.execute(state, async (signal) => {
      const loop = await this.ensureInitialized();
      return runAgentLoop(
        [toMessage(input.content)], this.createContextSnapshot(loop), loop.config,
        (event) => this.ingestLoopEvent(event), signal, loop.streamFn,
      );
    });
    return state.queue;
  }

  continue(): AsyncIterable<REMAgentEvent> {
    this.assertNotRunning();
    const lastMessage = this.messages.at(-1);
    if (!lastMessage) throw new Error('No messages to continue from');
    if (lastMessage.role === 'assistant') return this.continueWithSteering();
    const state = this.beginRun();
    void this.execute(state, async (signal) => {
      const loop = await this.ensureInitialized();
      return runAgentLoopContinue(
        this.createContextSnapshot(loop), loop.config,
        (event) => this.ingestLoopEvent(event), signal, loop.streamFn,
      );
    });
    return state.queue;
  }

  steer(content: UserInputContent): void {
    this.steeringQueue.enqueue(toMessage(content));
  }

  followUp(content: UserInputContent): void {
    this.followUpQueue.enqueue(toMessage(content));
  }

  interrupt(): void {
    this.activeAbort?.abort();
  }

  emitMeta(event: RemMetaEvent): void {
    if (this.runState) this.runState.queue.push(event);
    else this.pendingMeta.push(event);
  }

  private ensureInitialized(): Promise<AssembledAgentLoop> {
    return (this.initPromise ??= assembleAgentLoop({
      ...this.params,
      messages: () => this.messages,
      drainSteering: () => this.steeringQueue.drain(),
      drainFollowUp: () => this.followUpQueue.drain(),
      emitMeta: (event) => this.emitMeta(event),
    }).then((loop) => (this.loop = loop)));
  }

  private continueWithSteering(): AsyncIterable<REMAgentEvent> {
    const messages = this.steeringQueue.drain();
    if (messages.length === 0) throw new Error('Cannot continue from message role: assistant');
    const state = this.beginRun();
    void this.execute(state, async (signal) => {
      const loop = await this.ensureInitialized();
      return runAgentLoop(
        messages, this.createContextSnapshot(loop), loop.config,
        (event) => this.ingestLoopEvent(event), signal, loop.streamFn,
      );
    });
    return state.queue;
  }

  private beginRun(): AgentRunState {
    this.assertNotRunning();
    this.status = 'running';
    const state = new AgentRunState(this.pendingMeta);
    this.pendingMeta = [];
    return (this.runState = state);
  }

  private async execute(state: AgentRunState, body: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
    const controller = new AbortController();
    this.activeAbort = controller;
    try {
      await body(controller.signal);
      this.status = state.complete();
    } catch (error) {
      try {
        await emitLoopFailure({
          error, aborted: controller.signal.aborted, model: this.loop?.config.model,
          emit: (event) => this.ingestLoopEvent(event),
        });
        this.status = state.complete();
      } catch (inner) {
        state.fail(inner);
        this.status = 'error';
      }
    } finally {
      this.activeAbort = undefined;
      state.finish();
    }
  }

  private ingestLoopEvent(event: AgentEvent): void {
    if (event.type === 'message_end') this.messages.push(event.message as Message);
    else if (event.type === 'turn_end') {
      this.turns += 1;
      if (this.loop?.maxTurns !== undefined && this.turns >= this.loop.maxTurns) this.interrupt();
    }
    this.runState?.ingest(event);
  }

  private createContextSnapshot(loop: AssembledAgentLoop): AgentContext {
    return {
      systemPrompt: loop.context.systemPrompt,
      messages: this.messages.slice(),
      tools: (loop.context.tools ?? []).slice(),
    };
  }

  private assertNotRunning(): void {
    if (this.status === 'running') throw new Error(`REMAgent "${this.agentId}" is already running`);
  }
}
