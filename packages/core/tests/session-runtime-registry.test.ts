import { describe, expect, it, vi } from 'vitest';
import { SessionRuntime } from '../src/session/runtime.js';
import { SessionRuntimeRegistry } from '../src/session/runtime-registry.js';

describe('SessionRuntimeRegistry', () => {
  it('并发首次加载只创建一个 Runtime', async () => {
    const registry = new SessionRuntimeRegistry();
    let resolve!: (runtime: SessionRuntime) => void;
    const pending = new Promise<SessionRuntime>((done) => { resolve = done; });
    const load = vi.fn(() => pending);
    const first = registry.getOrCreate('s-1', load);
    const second = registry.getOrCreate('s-1', load);
    const runtime = new SessionRuntime({ sessionId: 's-1', workspace: 'ws' });
    resolve(runtime);
    expect(await first).toBe(runtime);
    expect(await second).toBe(runtime);
    expect(load).toHaveBeenCalledOnce();
    expect(registry.get('s-1')).toBe(runtime);
  });

  it('加载失败后允许重试', async () => {
    const registry = new SessionRuntimeRegistry();
    await expect(registry.getOrCreate('s-1', async () => { throw new Error('failed'); }))
      .rejects.toThrow('failed');
    const runtime = new SessionRuntime({ sessionId: 's-1', workspace: 'ws' });
    await expect(registry.getOrCreate('s-1', async () => runtime)).resolves.toBe(runtime);
  });
});
