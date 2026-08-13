import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentRuntime, createAgentRuntimeFromEnv } from '../src/assembly/agent-runtime-assembly.js';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RunSignal } from '../src/domain/event/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import { LocalRunWorker } from '../src/execution/local-worker.js';
import { SqliteStorageProvider } from '../src/plugins/storage/sqlite/index.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import type { AgentDefinitionProvider } from '../src/sdk/agent-definition-provider.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import type { StorageProvider } from '../src/sdk/storage-provider.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const context = (): RuntimeRequestContext => ({
  tenantId: 'tenant-1', principal: { principalId: 'user-1', roles: ['member'] },
});
const definition = (): AgentDefinition => ({
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' },
});
const taskTrigger = { type: 'task' as const, input: { text: 'hi' } };

function injectedStorage(store: RuntimeStorage) {
  const close = vi.fn(async () => {});
  const init = vi.fn(async () => {});
  const provider = { init, close, runtimeStore: store } as unknown as StorageProvider;
  return { provider, close, init };
}

async function collect(stream: AsyncIterable<RunSignal>): Promise<string[]> {
  const types: string[] = [];
  for await (const signal of stream) types.push(signal.type);
  return types;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createAgentRuntime', () => {
  it('注入 storage/models/definitions/plugins，装配后跑通真实 run，initialize/shutdown 幂等', async () => {
    const { store } = await createFakeRuntimeStore();
    const { provider: storage, close } = injectedStorage(store);
    const assembly = await createFakeAssembly(); // mock models，无密钥无网络
    const register = vi.fn();
    const plugin: RuntimePlugin = { manifest: { pluginId: 'test-plugin', version: '1' }, register };

    const runtime = createAgentRuntime({
      agentDefinitions: new StaticAgentDefinitionProvider([definition()]),
      plugins: [plugin],
      storage,
      assembly,
      worker: { owner: 'test-worker', pollMs: 10 },
    });
    expect(register).toHaveBeenCalledTimes(1);
    expect(() => runtime.as(context())).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));

    await runtime.initialize();
    await runtime.initialize();

    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });
    // subscribe 只有在 onEventCommitted 接线存在时才能收到终态 Signal 并结束
    const reading = collect(scoped.runs.subscribe(run.runId));
    const finished = await scoped.runs.waitForCompletion(run.runId);
    expect(finished).toMatchObject({ runId: run.runId, status: 'completed' });
    expect(await reading).toEqual(['run.started', 'artifact.created', 'run.completed']);
    expect(await scoped.artifacts.listByRun(run.runId)).toHaveLength(1);

    await runtime.shutdown();
    await runtime.shutdown();
    // 注入的 Storage 生命周期归调用方，Runtime 不得关闭它
    expect(close).not.toHaveBeenCalled();
    expect(() => runtime.as(context())).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    await expect(runtime.initialize()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }, 15000);

  it('缺少 AgentDefinitionProvider 时拒绝装配', () => {
    expect(() => createAgentRuntime({} as never))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('注入的 assembly 其 Storage 也不由 Runtime 关闭', async () => {
    const { store } = await createFakeRuntimeStore();
    const { provider: storage } = injectedStorage(store);
    const assembly = await createFakeAssembly();
    const assemblyStorageClose = vi.spyOn(assembly.di.storage, 'close');
    const runtime = createAgentRuntime({
      agentDefinitions: new StaticAgentDefinitionProvider([definition()]),
      storage,
      assembly,
      worker: { pollMs: 60_000 },
    });
    await runtime.initialize();
    await runtime.shutdown();
    expect(assemblyStorageClose).not.toHaveBeenCalled();
  });

  it('Worker stop 抛错时自建 Storage 仍被关闭，且 Worker 错误优先抛出', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-shutdown-failure-'));
    vi.stubEnv('REM_AGENT_HOME', dir);
    vi.stubEnv('HOME', dir);
    const closeSpy = vi.spyOn(SqliteStorageProvider.prototype, 'close');
    const stopFailure = new Error('worker stop boom');
    // 不注入 assembly/storage：Runtime 自建默认装配，Storage 归 Runtime 所有
    const runtime = createAgentRuntime({
      agentDefinitions: new StaticAgentDefinitionProvider([definition()]),
      worker: { pollMs: 60_000 },
    });
    await runtime.initialize();

    vi.spyOn(LocalRunWorker.prototype, 'stop').mockRejectedValueOnce(stopFailure);
    await expect(runtime.shutdown()).rejects.toBe(stopFailure);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // shutdown 已终态，重试不再重复关闭
    await runtime.shutdown();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  }, 15000);
});

describe('createAgentRuntimeFromEnv', () => {
  it('使用默认 SQLite/模型配置完成初始化，shutdown 关闭自建默认 Storage 且幂等', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-from-env-'));
    vi.stubEnv('REM_AGENT_HOME', dir);
    vi.stubEnv('HOME', dir); // 让 homedir() 解析到临时目录，避免读取真实 ~/.rem-agent 配置
    const closeSpy = vi.spyOn(SqliteStorageProvider.prototype, 'close');

    const runtime = await createAgentRuntimeFromEnv({
      agentDefinitions: new StaticAgentDefinitionProvider([definition()]),
      worker: { pollMs: 60_000 },
    });

    // FromEnv 已完成旧 AgentAssembly 初始化与 Runtime 初始化，立即可用
    const scoped = runtime.as(context());
    expect(await scoped.agents.list()).toHaveLength(1);
    expect(await scoped.agents.get('assistant')).toMatchObject({ agentId: 'assistant', revision: '1' });

    await runtime.shutdown();
    await runtime.shutdown();
    expect(closeSpy).toHaveBeenCalledTimes(1); // 仅关闭 Runtime 自建的默认 Storage
    expect(() => runtime.as(context())).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    await expect(runtime.initialize()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }, 15000);

  it('初始化中途失败时关闭自建 Storage 并抛出原始错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-init-failure-'));
    vi.stubEnv('REM_AGENT_HOME', dir);
    vi.stubEnv('HOME', dir);
    const closeSpy = vi.spyOn(SqliteStorageProvider.prototype, 'close');
    // initializeAgentDI 打开 SQLite 之后，agentDefinitions.init() 抛错，调用方拿不到 runtime 句柄
    const initFailure = new Error('definitions init boom');
    const inner = new StaticAgentDefinitionProvider([definition()]);
    const failing: AgentDefinitionProvider = {
      init: async () => { throw initFailure; },
      get: (agentId, revision) => inner.get(agentId, revision),
      list: () => inner.list(),
    };

    await expect(createAgentRuntimeFromEnv({ agentDefinitions: failing, worker: { pollMs: 60_000 } }))
      .rejects.toBe(initFailure);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  }, 15000);
});
