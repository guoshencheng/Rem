import { describe, expect, it } from 'vitest';
import { RunLiveSignalProjector } from '../src/execution/run-live-signal-projector.js';

const assistant = (content: unknown[], stopReason = 'stop') => ({
  role: 'assistant', content, api: 'openai-completions', provider: 'test', model: 'test',
  usage: { input: 1, output: 1, totalTokens: 2 }, stopReason, timestamp: 1,
});

describe('RunLiveSignalProjector', () => {
  it('maps assistant text and reasoning deltas in order', () => {
    const signals: unknown[] = [];
    const projector = new RunLiveSignalProjector((signal) => signals.push(signal));
    projector.ingest({ type: 'message_start', message: assistant([]) } as never);
    projector.ingest({ type: 'message_update', message: assistant([]), assistantMessageEvent: {
      type: 'text_delta', contentIndex: 0, delta: 'hello', partial: assistant([]),
    } } as never);
    projector.ingest({ type: 'message_update', message: assistant([]), assistantMessageEvent: {
      type: 'thinking_delta', contentIndex: 1, delta: 'hmm', partial: assistant([]),
    } } as never);
    projector.ingest({ type: 'message_end', message: assistant([{ type: 'text', text: 'hello' }]) } as never);

    expect(signals).toEqual([
      { type: 'assistant.message.started', data: { messageIndex: 0 } },
      { type: 'assistant.text.delta', data: { messageIndex: 0, contentIndex: 0, delta: 'hello' } },
      { type: 'assistant.reasoning.delta', data: { messageIndex: 0, contentIndex: 1, delta: 'hmm' } },
      { type: 'assistant.message.completed', data: { messageIndex: 0, message: assistant([{ type: 'text', text: 'hello' }]) } },
    ]);
  });

  it('maps tool execution lifecycle with full JSON values', () => {
    const signals: unknown[] = [];
    const projector = new RunLiveSignalProjector((signal) => signals.push(signal));
    projector.ingest({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'search', args: { query: 'rem' } } as never);
    projector.ingest({ type: 'tool_execution_update', toolCallId: 'call-1', toolName: 'search', args: { query: 'rem' }, partialResult: { hitCount: 1 } } as never);
    projector.ingest({ type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'search', result: {
      content: [{ type: 'text', text: 'done' }], details: { source: 'test' },
    }, isError: false } as never);

    expect(signals).toEqual([
      { type: 'tool.execution.started', data: { toolCallId: 'call-1', toolName: 'search', input: { query: 'rem' } } },
      { type: 'tool.execution.updated', data: { toolCallId: 'call-1', toolName: 'search', input: { query: 'rem' }, partialResult: { hitCount: 1 } } },
      { type: 'tool.execution.completed', data: { toolCallId: 'call-1', toolName: 'search', result: { content: [{ type: 'text', text: 'done' }], details: { source: 'test' } }, isError: false } },
    ]);
  });

  it('does not expose provider error messages as completed assistant output', () => {
    const signals: unknown[] = [];
    const projector = new RunLiveSignalProjector((signal) => signals.push(signal));
    projector.ingest({ type: 'message_start', message: assistant([]) } as never);
    projector.ingest({ type: 'message_end', message: assistant([], 'error') } as never);
    expect(signals).toEqual([{ type: 'assistant.message.started', data: { messageIndex: 0 } }]);
  });

  it('attaches an execution source without changing the public payload', () => {
    const signals: unknown[] = [];
    const projector = new RunLiveSignalProjector((signal) => signals.push(signal), {
      nodeId: 'run:member:1', agentId: 'researcher', role: 'member',
    });
    projector.ingest({ type: 'message_start', message: assistant([]) } as never);
    expect(signals[0]).toEqual({
      type: 'assistant.message.started', data: { messageIndex: 0 },
      source: { nodeId: 'run:member:1', agentId: 'researcher', role: 'member' },
    });
  });
});
