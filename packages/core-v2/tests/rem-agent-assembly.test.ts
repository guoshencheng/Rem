import { describe, expect, it } from 'vitest';
import { REMAgent } from '../src/rem-agent.js';
import { createFakeAssembly, fakeSession } from './helpers/fake-di.js';

describe('REMAgent 装配（内部创建 pi agent）', () => {
  it('new REMAgent 直接装配（root，含 delegate_task/todo_write 工具）', async () => {
    const { di, runtimeConfig } = await createFakeAssembly();
    const session = fakeSession();

    const agent = new REMAgent({
      di,
      runtimeConfig,
      session,
      workspace: 'default',
      agentId: 'root',
      sessionId: session.sessionId,
      approvalState: { getOrCreate: () => { throw new Error('not used'); } },
      publishBus: () => {},
    });

    expect(agent).toBeInstanceOf(REMAgent);
    expect(agent.agentId).toBe('root');
    expect(agent.sessionId).toBe('s-1');
    expect(agent.status).toBe('idle');
  });

  it('缺 agent 且缺装配参数时构造抛错', () => {
    expect(() => new REMAgent({ agentId: 'root' })).toThrow('assembly params');
  });

  it('无标题 session 在 run 后产生 session-title 事件（titleProvider mock 返回标题）', async () => {
    const { di, runtimeConfig } = await createFakeAssembly();
    di.titleProvider = { generateTitle: async () => 'Mock Title' };
    const session = fakeSession('s-2');

    const agent = new REMAgent({
      di, runtimeConfig, session,
      workspace: 'default', agentId: 'root', sessionId: 's-2',
      approvalState: { getOrCreate: () => { throw new Error('not used'); } },
      publishBus: () => {},
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
