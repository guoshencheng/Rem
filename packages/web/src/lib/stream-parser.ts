import type { SSEEvent, AgentStreamChunk } from './types';

export function parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<SSEEvent> {
  const decoder = new TextDecoder();

  return {
    [Symbol.asyncIterator]: async function* () {
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType: string | undefined;
        let dataLines: string[] = [];

        for (const line of lines) {
          if (line === '') {
            if (dataLines.length > 0) {
              yield { event: eventType, data: dataLines.join('\n') };
              eventType = undefined;
              dataLines = [];
            }
            continue;
          }
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          }
        }

        if (done) {
          if (buffer.length > 0) {
            if (buffer.startsWith('data: ')) {
              dataLines.push(buffer.slice(6));
              if (dataLines.length > 0) {
                yield { event: eventType, data: dataLines.join('\n') };
              }
            }
          }
          return;
        }
      }
    },
  };
}

export function parseAgentStreamEvent(event: SSEEvent): AgentStreamChunk {
  return JSON.parse(event.data) as AgentStreamChunk;
}
