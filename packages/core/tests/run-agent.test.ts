import { describe, it, expect } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import type { TextContent, ImageContent } from '@earendil-works/pi-ai';
import { runAgent } from '../src/run-agent.js';
import { AgentState } from '../src/agent-state.js';
import { createFauxDi, stubRuntimeConfig } from './run-agent/faux-di.js';
import type { AgentStreamEvent } from '../src/types.js';

describe('runAgent', () => {
  it('returns a stream and output promise', async () => {
    const { di } = createFauxDi({ responses: [fauxAssistantMessage('hello back')] });
    const result = runAgent({
      input: { content: 'hi' },
      sessionId: 'test-session',
      di, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });

    const chunks: AgentStreamEvent[] = [];
    for await (const chunk of result.stream.fullStream) chunks.push(chunk);
    const output = await result.output;

    expect(output.content).toBe('hello back');
    expect(chunks.some((c) => c.type === 'message-start')).toBe(true);
    expect(chunks[chunks.length - 1].type).toBe('finish');
  });

  it('passes through multipart user content (text + image) to the session', async () => {
    const { di, sessionProvider } = createFauxDi({ responses: [fauxAssistantMessage('seen')] });
    const parts: (TextContent | ImageContent)[] = [
      { type: 'text', text: 'look at this' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ];

    const result = runAgent({
      input: { content: parts },
      sessionId: 'test-session-parts',
      di, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const session = await sessionProvider.load('test-session-parts');
    expect(session!.conversation[0].role).toBe('user');
    expect(session!.conversation[0].content).toEqual(parts);
  });

  it('accumulates usage and writes history', async () => {
    const { di, sessionProvider } = createFauxDi({ responses: [fauxAssistantMessage('ok')] });
    const result = runAgent({
      input: { content: 'hi' },
      sessionId: 'usage-session',
      di, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const session = await sessionProvider.load('usage-session');
    const history = (session!.metadata.tokenUsageHistory as unknown[]) ?? [];
    expect(history).toHaveLength(1);
    const messageTokenUsage = (session!.metadata.messageTokenUsage as Record<string, unknown>) ?? {};
    expect(Object.keys(messageTokenUsage)).toHaveLength(1);
  });

  it('emits error chunk and Error output when the provider fails', async () => {
    const { di } = createFauxDi({
      responses: [fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'stream boom' })],
    });
    const result = runAgent({
      input: { content: 'hi' },
      sessionId: 'error-session',
      di, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });

    const chunks: AgentStreamEvent[] = [];
    for await (const chunk of result.stream.fullStream) chunks.push(chunk);
    const output = await result.output;

    expect(output.content).toBe('Error: stream boom');
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });
});
