import type { AgentStreamChunk, ContentPart } from 'rem-agent-core';

export function tapFullStream(
  source: AsyncIterable<AgentStreamChunk>,
  sessionId: string,
): AsyncIterable<AgentStreamChunk> {
  const parts: ContentPart[] = [];

  const applyChunk = (chunk: AgentStreamChunk) => {
    switch (chunk.type) {
      case 'text-start': {
        parts.push({ type: 'text', text: '' });
        break;
      }
      case 'text-delta': {
        const last = parts[parts.length - 1];
        if (last?.type === 'text') last.text += chunk.text;
        break;
      }
      case 'reasoning-start': {
        parts.push({ type: 'reasoning', text: '' });
        break;
      }
      case 'reasoning-delta': {
        const last = parts[parts.length - 1];
        if (last?.type === 'reasoning') last.text += chunk.text;
        break;
      }
      case 'tool-call-start': {
        parts.push({
          type: 'tool-call',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          arguments: {},
        });
        break;
      }
      case 'tool-call': {
        const part = parts.find((p): p is ContentPart & { type: 'tool-call' } =>
          p.type === 'tool-call' && p.toolCallId === chunk.toolCallId,
        );
        if (part) part.arguments = (chunk.input as Record<string, unknown>) ?? {};
        break;
      }
      case 'tool-result': {
        const part = parts.find((p): p is ContentPart & { type: 'tool-call' } =>
          p.type === 'tool-call' && p.toolCallId === chunk.toolCallId,
        );
        if (part) {
          part.result = {
            success: !chunk.error,
            output: chunk.output ?? '',
            error: chunk.error,
            durationMs: 0,
          };
        }
        break;
      }
      case 'finish': {
        break;
      }
      case 'error': {
        break;
      }
    }
  };

  return {
    [Symbol.asyncIterator]() {
      const it = source[Symbol.asyncIterator]();
      return {
        async next() {
          const r = await it.next();
          if (r.value) applyChunk(r.value);
          return r;
        }
      };
    }
  };
}
