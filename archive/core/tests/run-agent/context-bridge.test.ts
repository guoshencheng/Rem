import { describe, it, expect, vi } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { createContextBridge } from '../../src/run-agent/context-bridge.js';

const msg = (text: string): Message => ({ role: 'user', content: text, timestamp: 1 });

const baseParams = (overrides: Record<string, unknown> = {}) => ({
  compressor: { compress: vi.fn(async (msgs: Message[]) => msgs.slice(-1)) },
  shouldCompress: () => true,
  estimatedTokens: () => 100,
  threshold: () => 50,
  archive: vi.fn(async () => 'arc-1'),
  emit: () => {},
  sessionId: 's1',
  ...overrides,
});

describe('createContextBridge', () => {
  it('compresses once and appends post-compression messages on later turns', async () => {
    const params = baseParams();
    const events: { type: string }[] = [];
    params.emit = (e: { type: string }) => events.push(e);
    const bridge = createContextBridge(params as never);

    const first = await bridge.transformContext([msg('a'), msg('b'), msg('c')]);
    expect(first.map((m) => (m as Message).content)).toEqual(['c']);

    const second = await bridge.transformContext([msg('a'), msg('b'), msg('c'), msg('d')]);
    expect(second.map((m) => (m as Message).content)).toEqual(['c', 'd']);
    expect(params.compressor.compress).toHaveBeenCalledTimes(1);
    expect(params.archive).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(['compress-start', 'compress-end']);
  });

  it('passes messages through when shouldCompress is false', async () => {
    const params = baseParams({ shouldCompress: () => false });
    const bridge = createContextBridge(params as never);
    const result = await bridge.transformContext([msg('a')]);
    expect(result).toHaveLength(1);
    expect(params.compressor.compress).not.toHaveBeenCalled();
  });
});
