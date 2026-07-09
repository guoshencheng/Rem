import type { AgentOutput, AgentStream, AgentStreamChunk } from '../types.js';
import { generateId } from '../shared/generate-id.js';
import { aggregateText, aggregateUsage, aggregateSteps } from './stream-aggregators.js';
import { log } from '../shared/debug-log.js';

export type RawChunk =
  | { type: 'text-delta'; step: number; text: string }
  | { type: 'reasoning-delta'; step: number; text: string }
  | { type: 'tool-call'; step: number; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; step: number; toolCallId: string; output: string; error?: string };

export class AgentStreamController {
  private queue: AgentStreamChunk[] = [];
  private pending: Array<() => void> = [];
  private finished = false;
  private currentPart?: { type: string; partId: string };
  private lastStep = 0;

  append(chunk: RawChunk | AgentStreamChunk): void {
    if (this.finished) return;

    if (chunk.type === 'approval-request' || chunk.type === 'approval-resolved') {
      this.enqueue(chunk);
      return;
    }

    const rawChunk = chunk as RawChunk;
    this.lastStep = rawChunk.step;

    if (rawChunk.type === 'text-delta') {
      this.ensurePartOpen('text', rawChunk.step);
      this.enqueue({ type: 'text-delta', step: rawChunk.step, partId: this.currentPart!.partId, text: rawChunk.text });
    } else if (rawChunk.type === 'reasoning-delta') {
      this.ensurePartOpen('reasoning', rawChunk.step);
      this.enqueue({ type: 'reasoning-delta', step: rawChunk.step, partId: this.currentPart!.partId, text: rawChunk.text });
    } else if (rawChunk.type === 'tool-call') {
      this.closeCurrentPart(rawChunk.step);
      const partId = rawChunk.toolCallId;
      this.enqueue({ type: 'tool-call-start', step: rawChunk.step, partId, toolCallId: rawChunk.toolCallId, toolName: rawChunk.toolName });
      this.enqueue({ type: 'tool-call', step: rawChunk.step, partId, toolCallId: rawChunk.toolCallId, toolName: rawChunk.toolName, input: rawChunk.input });
      this.enqueue({ type: 'tool-call-finish', step: rawChunk.step, partId, toolCallId: rawChunk.toolCallId, toolName: rawChunk.toolName });
    } else if (rawChunk.type === 'tool-result') {
      this.closeCurrentPart(rawChunk.step);
      const partId = rawChunk.toolCallId;
      this.enqueue({ type: 'tool-result-start', step: rawChunk.step, partId, toolCallId: rawChunk.toolCallId });
      this.enqueue({ type: 'tool-result', step: rawChunk.step, partId, toolCallId: rawChunk.toolCallId, output: rawChunk.output, error: rawChunk.error });
      this.enqueue({ type: 'tool-result-finish', step: rawChunk.step, partId, toolCallId: rawChunk.toolCallId });
    }
  }

  emit(chunk: import('../types.js').ProviderChunk | AgentStreamChunk): void {
    if (this.finished) return;

    if (chunk.type === 'usage') {
      this.enqueue(chunk as AgentStreamChunk);
      return;
    }

    const rawTypes = [
      'text-delta',
      'reasoning-delta',
      'tool-call',
      'tool-result',
      'approval-request',
      'approval-resolved',
    ];

    if (rawTypes.includes(chunk.type)) {
      this.append(chunk as RawChunk);
      return;
    }

    if (chunk.type === 'message-start') {
      log('stream', 'message started', { messageId: chunk.messageId, step: chunk.step });
    } else if (chunk.type === 'text-start') {
      log('stream', 'text part started', { partId: chunk.partId, step: chunk.step });
    } else if (chunk.type === 'reasoning-start') {
      log('stream', 'reasoning part started', { partId: chunk.partId, step: chunk.step });
    } else if (chunk.type === 'tool-call-start') {
      log('stream', 'tool call started', { partId: chunk.partId, step: chunk.step, toolCallId: chunk.toolCallId, toolName: chunk.toolName });
    } else if (chunk.type === 'tool-result-start') {
      log('stream', 'tool result started', { partId: chunk.partId, step: chunk.step, toolCallId: chunk.toolCallId });
    }

    this.enqueue(chunk as AgentStreamChunk);
    if ('step' in chunk && typeof (chunk as { step: number }).step === 'number') {
      this.lastStep = (chunk as { step: number }).step;
    }
  }

  finish(output: AgentOutput): void {
    if (this.finished) return;
    this.closeCurrentPart(this.lastStep);
    log('stream', 'stream finished', { step: this.lastStep, outputLength: output.content.length });
    this.enqueue({ type: 'finish', output });
    this.finished = true;
    for (const resolve of this.pending) resolve();
    this.pending = [];
  }

  fail(error: Error): void {
    if (this.finished) return;
    this.closeCurrentPart(this.lastStep);
    log('stream', 'stream failed', { step: this.lastStep, error: error.message });
    this.enqueue({ type: 'error', error });
    this.finished = true;
    for (const resolve of this.pending) resolve();
    this.pending = [];
  }

  pushTitle(title: string): void {
    if (this.finished) return;
    this.enqueue({ type: 'session-title', title });
  }

  messageStart(messageId: string, step: number): void {
    if (this.finished) return;
    this.lastStep = step;
    this.enqueue({ type: 'message-start', step, messageId });
  }

  stepStart(step: number): void {
    if (this.finished) return;
    this.lastStep = step;
    this.enqueue({ type: 'step-start', step });
  }

  stepFinish(step: number): void {
    if (this.finished) return;
    this.lastStep = step;
    this.enqueue({ type: 'step-finish', step });
  }

  get stream(): AgentStream {
    return {
      fullStream: this.createIterator(),
      text: this.waitForFinish().then(() => aggregateText(this.queue)),
      usage: this.waitForFinish().then(() => aggregateUsage(this.queue)),
      steps: this.waitForFinish().then(() => aggregateSteps(this.queue)),
    };
  }

  private waitForFinish(): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = () => {
        if (this.finished) {
          return resolve();
        }
        setTimeout(check, 10);
      };
      check();
    });
  }

  private ensurePartOpen(type: 'text' | 'reasoning', step: number): void {
    if (this.currentPart && this.currentPart.type === type) {
      return;
    }
    this.closeCurrentPart(step);
    const partId = generateId();
    this.currentPart = { type, partId };
    if (type === 'text') {
      this.enqueue({ type: 'text-start', step, partId });
    } else {
      this.enqueue({ type: 'reasoning-start', step, partId });
    }
  }

  private closeCurrentPart(step: number): void {
    if (!this.currentPart) return;
    const { type, partId } = this.currentPart;
    this.currentPart = undefined;
    if (type === 'text') {
      this.enqueue({ type: 'text-finish', step, partId });
    } else if (type === 'reasoning') {
      this.enqueue({ type: 'reasoning-finish', step, partId });
    }
  }

  private enqueue(chunk: AgentStreamChunk): void {
    this.queue.push(chunk);
    const resolve = this.pending.shift();
    if (resolve) resolve();
  }

  private createIterator(): AsyncIterable<AgentStreamChunk> {
    let index = 0;
    const controller = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentStreamChunk> {
        return {
          async next(): Promise<IteratorResult<AgentStreamChunk>> {
            while (true) {
              if (index < controller.queue.length) {
                const chunk = controller.queue[index++];
                return { done: false, value: chunk };
              }
              if (controller.finished) {
                return { done: true, value: undefined };
              }
              await new Promise<void>((resolve) => {
                controller.pending.push(() => resolve());
              });
            }
          },
        };
      },
    };
  }

}
