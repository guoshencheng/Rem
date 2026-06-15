import type { AgentOutput, AgentStream, AgentStreamChunk, AgentStreamStepResult } from '../types.js';
import type { LanguageModelUsage } from 'ai';

export class AgentStreamController {
  private queue: AgentStreamChunk[] = [];
  private pending: Array<() => void> = [];
  private finished = false;
  private error?: Error;

  append(chunk: AgentStreamChunk): void {
    if (this.finished) return;
    this.queue.push(chunk);
    const resolve = this.pending.shift();
    if (resolve) resolve();
  }

  finish(output: AgentOutput): void {
    if (this.finished) return;
    this.append({ type: 'finish', output });
    this.finished = true;
    for (const resolve of this.pending) resolve();
    this.pending = [];
  }

  fail(error: Error): void {
    if (this.finished) return;
    this.append({ type: 'error', error });
    this.finished = true;
    this.error = error;
    for (const resolve of this.pending) resolve();
    this.pending = [];
  }

  get stream(): AgentStream {
    return {
      fullStream: this.createIterator(),
      text: this.aggregateText(),
      usage: this.aggregateUsage(),
      steps: this.aggregateSteps(),
    };
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
        .filter((c): c is { type: 'text-delta'; step: number; partIndex: number; text: string } => c.type === 'text-delta')
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
          stepMap.get(chunk.step)!.text += chunk.text;
        } else if (chunk.type === 'reasoning-delta') {
          stepMap.get(chunk.step)!.reasoning += chunk.text;
        } else if (chunk.type === 'tool-call') {
          stepMap.get(chunk.step)!.toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          });
        } else if (chunk.type === 'tool-result') {
          const tc = stepMap.get(chunk.step)!.toolCalls.find((t: { toolCallId: string }) => t.toolCallId === chunk.toolCallId);
          if (tc) {
            tc.output = chunk.output;
            tc.error = chunk.error;
          }
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
