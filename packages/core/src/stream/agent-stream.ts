import type { AgentOutput, AgentStream, AgentStreamChunk, AgentStreamStepResult } from '../types.js';
import type { LanguageModelUsage } from 'ai';
import { generateId } from 'ai';

type RawChunk =
  | { type: 'text-delta'; step: number; text: string }
  | { type: 'reasoning-delta'; step: number; text: string }
  | { type: 'tool-call'; step: number; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; step: number; toolCallId: string; output: string; error?: string };

export class AgentStreamController {
  private queue: AgentStreamChunk[] = [];
  private pending: Array<() => void> = [];
  private finished = false;
  private error?: Error;
  private currentPart?: { type: string; partId: string };
  private lastStep = 0;

  append(chunk: RawChunk): void {
    if (this.finished) return;
    this.lastStep = chunk.step;

    if (chunk.type === 'text-delta') {
      this.ensurePartOpen('text', chunk.step);
      this.enqueue({ type: 'text-delta', step: chunk.step, partId: this.currentPart!.partId, text: chunk.text });
    } else if (chunk.type === 'reasoning-delta') {
      this.ensurePartOpen('reasoning', chunk.step);
      this.enqueue({ type: 'reasoning-delta', step: chunk.step, partId: this.currentPart!.partId, text: chunk.text });
    } else if (chunk.type === 'tool-call') {
      this.closeCurrentPart(chunk.step);
      const partId = chunk.toolCallId;
      this.enqueue({ type: 'tool-call-start', step: chunk.step, partId, toolCallId: chunk.toolCallId, toolName: chunk.toolName });
      this.enqueue({ type: 'tool-call', step: chunk.step, partId, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input });
      this.enqueue({ type: 'tool-call-finish', step: chunk.step, partId, toolCallId: chunk.toolCallId, toolName: chunk.toolName });
    } else if (chunk.type === 'tool-result') {
      this.closeCurrentPart(chunk.step);
      const partId = chunk.toolCallId;
      this.enqueue({ type: 'tool-result-start', step: chunk.step, partId, toolCallId: chunk.toolCallId });
      this.enqueue({ type: 'tool-result', step: chunk.step, partId, toolCallId: chunk.toolCallId, output: chunk.output, error: chunk.error });
      this.enqueue({ type: 'tool-result-finish', step: chunk.step, partId, toolCallId: chunk.toolCallId });
    }
  }

  finish(output: AgentOutput): void {
    if (this.finished) return;
    this.closeCurrentPart(this.lastStep);
    this.enqueue({ type: 'finish', output });
    this.finished = true;
    for (const resolve of this.pending) resolve();
    this.pending = [];
  }

  fail(error: Error): void {
    if (this.finished) return;
    this.closeCurrentPart(this.lastStep);
    this.enqueue({ type: 'error', error });
    this.finished = true;
    this.error = error;
    for (const resolve of this.pending) resolve();
    this.pending = [];
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
      text: this.aggregateText(),
      usage: this.aggregateUsage(),
      steps: this.aggregateSteps(),
    };
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

  private aggregateText(): Promise<string> {
    return this.aggregateRun((chunks) =>
      chunks
        .filter((c): c is { type: 'text-delta'; step: number; partId: string; text: string } => c.type === 'text-delta')
        .map((c) => c.text)
        .join(''),
    );
  }

  private aggregateUsage(): Promise<LanguageModelUsage> {
    return this.aggregateRun(() => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    }));
  }

  private aggregateSteps(): Promise<AgentStreamStepResult[]> {
    return this.aggregateRun((chunks) => {
      const stepMap = new Map<number, AgentStreamStepResult>();
      for (const chunk of chunks) {
        if (chunk.type === 'step-start') {
          stepMap.set(chunk.step, { step: chunk.step, text: '', reasoning: '', toolCalls: [] });
        } else if (chunk.type === 'text-delta') {
          const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
          step.text += chunk.text;
          stepMap.set(chunk.step, step);
        } else if (chunk.type === 'reasoning-delta') {
          const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
          step.reasoning += chunk.text;
          stepMap.set(chunk.step, step);
        } else if (chunk.type === 'tool-call') {
          const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
          step.toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          });
          stepMap.set(chunk.step, step);
        } else if (chunk.type === 'tool-result') {
          const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
          const tc = step.toolCalls.find((t: { toolCallId: string }) => t.toolCallId === chunk.toolCallId);
          if (tc) {
            tc.output = chunk.output;
            tc.error = chunk.error;
          }
          stepMap.set(chunk.step, step);
        }
      }
      return [...stepMap.values()];
    });
  }

  private aggregateRun<T>(handler: (chunks: AgentStreamChunk[]) => T): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.finished) {
          if (this.error) return reject(this.error);
          return resolve(handler([...this.queue]));
        }
        setTimeout(check, 10);
      };
      check();
    });
  }
}
