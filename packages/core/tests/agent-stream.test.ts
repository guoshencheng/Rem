import { describe, it, expect } from 'vitest';
import type { AgentStreamChunk } from '../src/types.js';
import { AgentStreamController } from '../src/stream/agent-stream.js';

describe('AgentStreamController', () => {
  it('emits text-start before first text-delta and text-finish after switch', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'text-delta', step: 1, text: 'hello ' });
    controller.append({ type: 'text-delta', step: 1, text: 'world' });
    controller.append({ type: 'reasoning-delta', step: 1, text: 'think' });
    controller.finish({ content: 'done', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    const types = chunks.map(c => c.type);
    expect(types).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'text-finish',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-finish',
      'finish',
    ]);

    const textStart = chunks.find(c => c.type === 'text-start') as Extract<AgentStreamChunk, { type: 'text-start' }> | undefined;
    const reasoningStart = chunks.find(c => c.type === 'reasoning-start') as Extract<AgentStreamChunk, { type: 'reasoning-start' }> | undefined;
    expect(textStart!.partId).toBeDefined();
    expect(reasoningStart!.partId).toBeDefined();
    expect(textStart!.partId).not.toBe(reasoningStart!.partId);
  });

  it('emits tool-call as triple start/payload/finish', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'tool-call', step: 1, toolCallId: 'tc1', toolName: 'search', input: { q: 'x' } });
    controller.finish({ content: 'done', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks.map(c => c.type)).toEqual([
      'tool-call-start',
      'tool-call',
      'tool-call-finish',
      'finish',
    ]);
    expect((chunks[0] as Extract<AgentStreamChunk, { type: 'tool-call-start' }>).partId).toBe('tc1');
    expect((chunks[1] as Extract<AgentStreamChunk, { type: 'tool-call' }>).partId).toBe('tc1');
    expect((chunks[2] as Extract<AgentStreamChunk, { type: 'tool-call-finish' }>).partId).toBe('tc1');
  });

  it('uses toolCallId as partId for tool-result', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'tool-result', step: 1, toolCallId: 'tc1', output: 'ok' });
    controller.finish({ content: 'done', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks[0].type).toBe('tool-result-start');
    expect((chunks[0] as Extract<AgentStreamChunk, { type: 'tool-result-start' }>).partId).toBe('tc1');
    expect(chunks[1].type).toBe('tool-result');
    expect(chunks[2].type).toBe('tool-result-finish');
  });

  it('aggregates text correctly', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'text-delta', step: 1, text: 'hello ' });
    controller.append({ type: 'text-delta', step: 1, text: 'world' });
    controller.finish({ content: 'hello world', completed: true });

    expect(await controller.stream.text).toBe('hello world');
  });

  it('emits message-start with messageId', async () => {
    const controller = new AgentStreamController();
    controller.messageStart('msg-1', 1);
    controller.append({ type: 'text-delta', step: 1, text: 'hi' });
    controller.finish({ content: 'done', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    const ms = chunks.find(c => c.type === 'message-start') as Extract<AgentStreamChunk, { type: 'message-start' }> | undefined;
    expect(ms).toBeDefined();
    expect(ms!.messageId).toBe('msg-1');
    expect(ms!.step).toBe(1);
    expect(chunks[0].type).toBe('message-start');
  });

  it('closes open parts on finish', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'text-delta', step: 1, text: 'hi' });
    controller.finish({ content: 'hi', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks[chunks.length - 2].type).toBe('text-finish');
    expect(chunks[chunks.length - 1].type).toBe('finish');
  });

  it('does not let stream.text/usage/steps reject on fail', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'text-delta', step: 1, text: 'partial' });
    controller.fail(new Error('stream error'));

    const chunks: AgentStreamChunk[] = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'error')).toBe(true);

    // These should resolve (not reject) so consumers who only drain fullStream
    // don't get unhandled rejections from the aggregate promises.
    await expect(controller.stream.text).resolves.toBeDefined();
    await expect(controller.stream.usage).resolves.toBeDefined();
    await expect(controller.stream.steps).resolves.toBeDefined();
  });
});
