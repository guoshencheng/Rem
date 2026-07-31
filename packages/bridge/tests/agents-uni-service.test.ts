import { afterEach, describe, expect, it } from 'vitest';
import { createTestService, waitForBusEvent, DEFAULT_WORKSPACE, type TestService } from './helpers/test-service.js';

let ctx: TestService | undefined;
afterEach(async () => { await ctx?.cleanup(); ctx = undefined; });

describe('AgentsUniService', () => {
  it('createSession / listSessions 按 workspace 隔离', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);
    expect(s.workspace).toBe(DEFAULT_WORKSPACE);
    const list = await ctx.service.listSessions(DEFAULT_WORKSPACE);
    expect(list.some((x) => x.sessionId === s.sessionId)).toBe(true);
    const other = await ctx.service.listSessions('nonexistent-ws');
    expect(other).toEqual([]);
  });

  it('run 完整链路：session-start → chunk → session-end，消息落盘可查', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);

    const endPromise = waitForBusEvent(ctx.service, (e) => e.type === 'session-end' && e.sessionId === s.sessionId);
    await ctx.service.run(DEFAULT_WORKSPACE, s.sessionId, 'hello');
    await endPromise;

    const messages = await ctx.service.getMessages(DEFAULT_WORKSPACE, s.sessionId);
    expect(messages.some((m) => m.role === 'user')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant')).toBe(true);
  }, 15000);

  it('同一 session 连续 run 复用 root Agent 并延续 transcript', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);

    const firstEnd = waitForBusEvent(
      ctx.service,
      (e) => e.type === 'session-end' && e.sessionId === s.sessionId,
    );
    await ctx.service.run(DEFAULT_WORKSPACE, s.sessionId, 'first');
    await firstEnd;
    const remSession = ctx.service.sessions.get(s.sessionId);
    const firstRoot = remSession?.rootAgent;

    const secondEnd = waitForBusEvent(
      ctx.service,
      (e) => e.type === 'session-end' && e.sessionId === s.sessionId,
    );
    await ctx.service.run(DEFAULT_WORKSPACE, s.sessionId, 'second');
    await secondEnd;

    expect(firstRoot).toBeDefined();
    expect(remSession?.rootAgent).toBe(firstRoot);
    const messages = await ctx.service.getMessages(DEFAULT_WORKSPACE, s.sessionId);
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(2);
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(2);
  });

  it('不同 session 使用不同 root Agent', async () => {
    ctx = await createTestService();
    const first = await ctx.service.createSession(DEFAULT_WORKSPACE);
    const second = await ctx.service.createSession(DEFAULT_WORKSPACE);

    const firstEnd = waitForBusEvent(
      ctx.service,
      (e) => e.type === 'session-end' && e.sessionId === first.sessionId,
    );
    await ctx.service.run(DEFAULT_WORKSPACE, first.sessionId, 'first');
    await firstEnd;

    const secondEnd = waitForBusEvent(
      ctx.service,
      (e) => e.type === 'session-end' && e.sessionId === second.sessionId,
    );
    await ctx.service.run(DEFAULT_WORKSPACE, second.sessionId, 'second');
    await secondEnd;

    expect(ctx.service.sessions.get(first.sessionId)?.rootAgent).toBeDefined();
    expect(ctx.service.sessions.get(second.sessionId)?.rootAgent).toBeDefined();
    expect(ctx.service.sessions.get(first.sessionId)?.rootAgent)
      .not.toBe(ctx.service.sessions.get(second.sessionId)?.rootAgent);
  });

  it('running 中重复 run 抛 409', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);
    // mock provider 立即完成，用手动 gate 让 run 保持 running 较麻烦；
    // 改为直接断言 sessions 状态机：先占住 running
    const remSession = ctx.service.sessions.getOrCreate(s.sessionId, DEFAULT_WORKSPACE);
    remSession.startRun();
    await expect(ctx.service.run(DEFAULT_WORKSPACE, s.sessionId, 'hi')).rejects.toMatchObject({ status: 409 });
  });

  it('steer/followUp 非 running 抛 409；interrupt/reset 不抛', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);
    await expect(ctx.service.steer(DEFAULT_WORKSPACE, s.sessionId, 'x')).rejects.toMatchObject({ status: 409 });
    await expect(ctx.service.followUp(DEFAULT_WORKSPACE, s.sessionId, 'x')).rejects.toMatchObject({ status: 409 });
    await expect(ctx.service.interrupt(DEFAULT_WORKSPACE, s.sessionId)).resolves.toBeUndefined();
    await expect(ctx.service.reset(DEFAULT_WORKSPACE, s.sessionId)).resolves.toBeUndefined();
  });

  it('deleteSession 后可清理内存状态；getMessages 404', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);
    ctx.service.sessions.getOrCreate(s.sessionId, DEFAULT_WORKSPACE);
    await ctx.service.deleteSession(DEFAULT_WORKSPACE, s.sessionId);
    expect(ctx.service.sessions.get(s.sessionId)).toBeUndefined();
    await expect(ctx.service.getMessages(DEFAULT_WORKSPACE, s.sessionId)).rejects.toMatchObject({ status: 404 });
  });
});
