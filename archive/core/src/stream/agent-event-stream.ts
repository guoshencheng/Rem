import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentStreamEvent, RemMetaEvent, AgentStream, AgentOutput, AgentStreamStepResult } from '../types.js';
import type { Usage } from '@earendil-works/pi-ai';

export class AgentEventStreamController {
  private queue: AgentStreamEvent[] = [];
  private resolvers: ((event: AgentStreamEvent) => void)[] = [];
  private _done = false;
  private _error: Error | null = null;
  private textPromise: Promise<string>;
  private usagePromise: Promise<Usage>;
  private stepsPromise: Promise<AgentStreamStepResult[]>;
  private textResolve!: (value: string) => void;
  private usageResolve!: (value: Usage) => void;
  private stepsResolve!: (value: AgentStreamStepResult[]) => void;

  constructor() {
    this.textPromise = new Promise((resolve) => (this.textResolve = resolve));
    this.usagePromise = new Promise((resolve) => (this.usageResolve = resolve));
    this.stepsPromise = new Promise((resolve) => (this.stepsResolve = resolve));
  }

  get stream(): AgentStream {
    return {
      fullStream: this.iterate(),
      text: this.textPromise,
      usage: this.usagePromise,
      steps: this.stepsPromise,
    };
  }

  emit(event: AgentStreamEvent): void {
    if (this._done) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(event);
    } else {
      this.queue.push(event);
    }
  }

  finish(output: AgentOutput, finalMessage?: AssistantMessage): void {
    if (finalMessage?.usage) this.usageResolve(finalMessage.usage);
    this.textResolve(
      finalMessage?.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('') ?? '',
    );
    this.stepsResolve([]);
    this.emit({ type: 'finish', output });
    this._done = true;
  }

  fail(error: Error): void {
    this._error = error;
    this.emit({ type: 'error', error: { name: error.name, message: error.message, stack: error.stack } });
    this._done = true;
  }

  pushTitle(title: string): void {
    this.emit({ type: 'session-title', title });
  }

  private async *iterate(): AsyncIterable<AgentStreamEvent> {
    while (!this._done || this.queue.length > 0) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else {
        const event = await new Promise<AgentStreamEvent>((resolve) => this.resolvers.push(resolve));
        yield event;
      }
    }
  }
}
