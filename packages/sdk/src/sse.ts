import type { AgentStreamChunk } from 'rem-agent-core';

export interface SSEEvent {
  event?: string;
  data: string;
}

export function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncIterable<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    [Symbol.asyncIterator]: async function* () {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent: Partial<SSEEvent> = {};
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent.event = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = line.slice(6);
          } else if (line === '') {
            if (currentEvent.data !== undefined) {
              yield currentEvent as SSEEvent;
            }
            currentEvent = {};
          }
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split('\n');
        let currentEvent: Partial<SSEEvent> = {};
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent.event = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = line.slice(6);
          } else if (line === '' && currentEvent.data !== undefined) {
            yield currentEvent as SSEEvent;
            currentEvent = {};
          }
        }
      }
    },
  };
}

export function parseAgentStreamEvent(event: SSEEvent): AgentStreamChunk {
  return JSON.parse(event.data) as AgentStreamChunk;
}
