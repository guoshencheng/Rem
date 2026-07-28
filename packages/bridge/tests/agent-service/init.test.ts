import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../../src/agent.js';
import { createAgentAssembly, createDefaultAgentPaths, initializeAgentDI } from 'rem-agent-core';

const DEFAULT_WORKSPACE = 'default';

describe('AgentService 已初始化 DI 构造', { timeout: 20000 }, () => {
  let dir: string;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-init-test-'));
    const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });
    const { di, runtimeConfig } = createAgentAssembly({ paths });
    await initializeAgentDI(di, { skipMcp: true });
    service = new AgentService(di, runtimeConfig);
  });

  afterEach(async () => {
    service.di.storage.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('exposes di and runtimeConfig after construction', () => {
    expect(service.di).toBeDefined();
    expect(service.di.sessionProvider).toBeDefined();
    expect(service.runtimeConfig.securityMode).toBe('interactive');
  });

  it('可以直接调用业务方法无需 init', async () => {
    const summary = await service.createSession(DEFAULT_WORKSPACE);
    expect(summary.sessionId).toBeDefined();
    expect(summary.title).toBe('New Chat');
  });

  it('重复创建 AgentService 不报错（无 init 守卫）', async () => {
    // 用同一个已初始化的 di 再构造一个 AgentService
    const service2 = new AgentService(service.di, service.runtimeConfig);
    const summary = await service2.createSession(DEFAULT_WORKSPACE);
    expect(summary.sessionId).toBeDefined();
  });
});
