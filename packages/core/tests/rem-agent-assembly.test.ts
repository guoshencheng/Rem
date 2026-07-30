import { describe, expect, it } from 'vitest';
import { REMAgent } from '../src/agent/rem-agent.js';
import { createFakeAssembly, fakeSession } from './helpers/fake-di.js';
import { createMockModels } from './helpers/mock-models.js';

describe('REMAgent 装配（首次 run 惰性初始化）', () => {
  it('new REMAgent 同步构造即可用（root，含 delegate_task/todo_write 工具）', async () => {
    const { di, runtimeConfig } = await createFakeAssembly();
    const session = fakeSession();

    const agent = new REMAgent({
      di,
      runtimeConfig,
      session,
      workspace: 'default',
      agentId: 'root',
      sessionId: session.sessionId,
    });

    expect(agent).toBeInstanceOf(REMAgent);
    expect(agent.agentId).toBe('root');
    expect(agent.sessionId).toBe('s-1');
    expect(agent.status).toBe('idle');
  });

  it('惰性初始化失败（未知模型）时 run 产生 error 事件而不抛错', async () => {
    const { di, runtimeConfig } = await createFakeAssembly();
    di.models = createMockModels({ name: 'other' });
    const session = fakeSession();
    const agent = new REMAgent({
      di,
      runtimeConfig,
      session,
      workspace: 'default',
      agentId: 'root',
      sessionId: session.sessionId,
    });

    const seen: string[] = [];
    let errorMessage = '';
    for await (const e of agent.run({ content: 'hi' })) {
      seen.push(e.type);
      if (e.type === 'error') errorMessage = e.error.message;
      if (e.type === 'finish' || e.type === 'error') break;
    }
    expect(seen).toContain('error');
    expect(errorMessage).toContain('Unknown model');
  });

  it('无标题 session 在 run 后产生 session-title 事件（titleProvider mock 返回标题）', async () => {
    const { di, runtimeConfig } = await createFakeAssembly();
    di.titleProvider = { generateTitle: async () => 'Mock Title' };
    const session = fakeSession('s-2');

    const agent = new REMAgent({
      di, runtimeConfig, session,
      workspace: 'default', agentId: 'root', sessionId: 's-2',
    });

    // mock provider 默认立即 done 一条 'Hello' assistant 消息，可以跑完整 run
    const seen: string[] = [];
    for await (const e of agent.run({ content: 'hi' })) {
      seen.push(e.type);
      if (e.type === 'finish' || e.type === 'error') break;
    }
    expect(seen).toContain('session-title');
    expect(seen).toContain('finish');
  }, 15000);
});
