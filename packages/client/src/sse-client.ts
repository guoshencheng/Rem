import type { RunSignal } from 'rem-agent-core';
import { RuntimeClientError } from './client-error.js';
import { RuntimeHttpClient, parseError } from './http-client.js';
import { decodeSignal } from './wire-values.js';
import type { SubscribeOptions, WaitForCompletionOptions } from './types.js';

export function subscribeToRun(
  http: RuntimeHttpClient,
  runId: string,
  options?: SubscribeOptions,
): AsyncIterable<RunSignal> {
  return { [Symbol.asyncIterator]: () => iterateSignals(http, runId, options?.signal) };
}

export async function waitForRemoteRun(
  http: RuntimeHttpClient,
  runId: string,
  options?: WaitForCompletionOptions,
): Promise<import('rem-agent-core').Run> {
  options?.signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(options?.signal?.reason);
  options?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const initial = await http.getRun(runId);
    options?.signal?.throwIfAborted();
    if (isTerminalStatus(initial.status)) return initial;

    const iterator = subscribeToRun(http, runId, { signal: controller.signal })[Symbol.asyncIterator]();
    try {
      for (;;) {
        let result: IteratorResult<RunSignal>;
        try {
          result = await iterator.next();
        } catch (error) {
          options?.signal?.throwIfAborted();
          return await pollUntilTerminal(http, runId, options?.pollMs ?? 100, controller.signal);
        }
        if (result.done) {
          return await pollUntilTerminal(http, runId, options?.pollMs ?? 100, controller.signal);
        }
        if (!isTerminalSignal(result.value.type)) continue;
        const completed = await http.getRun(runId);
        options?.signal?.throwIfAborted();
        return isTerminalStatus(completed.status)
          ? completed
          : pollUntilTerminal(http, runId, options?.pollMs ?? 100, controller.signal);
      }
    } finally {
      await iterator.return?.();
    }
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

function isTerminalStatus(status: import('rem-agent-core').RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isTerminalSignal(type: string): boolean {
  return type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled';
}

async function pollUntilTerminal(
  http: RuntimeHttpClient,
  runId: string,
  pollMs: number,
  signal: AbortSignal,
): Promise<import('rem-agent-core').Run> {
  for (;;) {
    const current = await http.getRun(runId);
    if (isTerminalStatus(current.status)) return current;
    await sleep(pollMs, signal);
  }
}

async function* iterateSignals(
  http: RuntimeHttpClient,
  runId: string,
  signal?: AbortSignal,
): AsyncGenerator<RunSignal> {
  const response = await http.raw(`/v1/runs/${encodeURIComponent(runId)}/stream`, {
    headers: { Accept: 'text/event-stream' }, signal,
  });
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new RuntimeClientError('INTERNAL_ERROR', 'Service returned an empty event stream', response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const signalValue = parseSignalFrame(frame);
        if (signalValue) yield signalValue;
      }
      if (chunk.done) {
        buffer += decoder.decode();
        const signalValue = parseSignalFrame(buffer);
        if (signalValue) yield signalValue;
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseSignalFrame(frame: string): RunSignal | undefined {
  const lines = frame.split(/\r?\n/);
  let event = '';
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart());
  }
  if (event !== 'signal') return undefined;
  if (data.length === 0) throw new RuntimeClientError('INVALID_INPUT', 'Signal frame has no data', 200);
  let parsed: unknown;
  try { parsed = JSON.parse(data.join('\n')); }
  catch (error) {
    throw new RuntimeClientError('INVALID_INPUT', 'Signal frame contains invalid JSON', 200, false, undefined, { cause: error });
  }
  try { return decodeSignal(parsed); }
  catch (error) {
    if (error instanceof RuntimeClientError) throw error;
    throw new RuntimeClientError('INVALID_INPUT', 'Signal frame contains invalid signal payload', 200, false, undefined, { cause: error });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', onAbort); resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
