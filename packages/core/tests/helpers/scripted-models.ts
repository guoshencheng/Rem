import type { AssistantMessage, Context, Model, Models, Provider } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createCoreModels } from 'rem-agent-core';
import { MockEventStream } from './mock-models.js';

export { fauxAssistantMessage, fauxToolCall };

export type ScriptedStep =
  | AssistantMessage
  | ((call: { context: Context; signal?: AbortSignal; callCount: number }) => AssistantMessage | Promise<AssistantMessage>);

export interface ScriptedModels {
  models: Models;
  state: { callCount: number };
  setResponses: (steps: ScriptedStep[]) => void;
}

const errorMessage = (text: string): AssistantMessage =>
  ({ ...fauxAssistantMessage(''), stopReason: 'error', errorMessage: text }) as AssistantMessage;

const abortedMessage = (base: AssistantMessage): AssistantMessage =>
  ({ ...base, stopReason: 'aborted', errorMessage: 'Request was aborted' }) as AssistantMessage;

/**
 * 脚本化 Provider：每次 LLM 调用弹出下一个 step（静态消息或工厂）。
 * 工厂 resolve 后若 signal 已 abort，产出 stopReason=aborted 的错误流。
 */
export function createScriptedModels(steps: ScriptedStep[]): ScriptedModels {
  let queue = [...steps];
  const state = { callCount: 0 };
  const model = {
    id: 'mock-model',
    name: 'mock-model',
    api: 'openai-completions',
    provider: 'mock',
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  } as Model<any>;

  const streamSimple = (_m: Model<any>, context: Context, options?: { signal?: AbortSignal }) => {
    state.callCount += 1;
    const callCount = state.callCount;
    const step = queue.shift();
    const eventStream = new MockEventStream();
    void (async () => {
      try {
        if (!step) throw new Error('script exhausted');
        const resolved = typeof step === 'function' ? await step({ context, signal: options?.signal, callCount }) : step;
        if (options?.signal?.aborted || resolved.stopReason === 'aborted') {
          const aborted = abortedMessage(resolved);
          eventStream.push({ type: 'error', reason: 'aborted', error: aborted });
          eventStream.end(aborted);
          return;
        }
        if (resolved.stopReason === 'error') {
          eventStream.push({ type: 'error', reason: 'error', error: resolved });
          eventStream.end(resolved);
          return;
        }
        eventStream.push({ type: 'start', partial: resolved });
        eventStream.push({ type: 'done', reason: 'stop', message: resolved });
        eventStream.end(resolved);
      } catch (error) {
        const failed = errorMessage(error instanceof Error ? error.message : String(error));
        eventStream.push({ type: 'error', reason: 'error', error: failed });
        eventStream.end(failed);
      }
    })();
    return eventStream;
  };

  const provider: Provider = {
    id: 'mock',
    name: 'mock',
    auth: {
      apiKey: { resolve: () => ({ auth: { apiKey: 'fake-key' }, source: 'env' }) },
      oauth: undefined as never,
    },
    getModels: () => [model],
    stream: streamSimple as Provider['stream'],
    complete: async () => fauxAssistantMessage('Mock Title'),
    streamSimple: streamSimple as Provider['streamSimple'],
    completeSimple: async () => fauxAssistantMessage('Mock Title'),
  } as Provider;

  const models = createCoreModels();
  models.setProvider(provider);
  return {
    models,
    state,
    setResponses: (next) => {
      queue = [...next];
    },
  };
}
