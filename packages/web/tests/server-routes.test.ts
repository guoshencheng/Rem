import { describe, expect, it } from 'vitest';
import type { SessionInfo, TeamInfo } from 'rem-agent-core';
import { createWebApp } from '../src/server/app.js';
import { createFakeAgentSystem } from './helpers/fake-agent-system.js';

const session: SessionInfo = {
  sessionId: 's1', workspace: '/ws', title: 'demo', updatedAt: 1, messageCount: 2, mode: 'single',
};
const team: TeamInfo = { id: 'research', organizer: 'lead', members: ['a', 'b'] };

function setup(options: Parameters<typeof createFakeAgentSystem>[0] = {}) {
  const fake = createFakeAgentSystem(options);
  const app = createWebApp({ system: fake.system, workspace: '/ws' });
  return { app, fake };
}

describe('sessions routes', () => {
  it('GET /api/rem/sessions 返回列表并传入 workspace', async () => {
    const { app, fake } = setup({ sessions: [session] });
    const res = await app.request('/api/rem/sessions');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([session]);
    expect(fake.calls[0]).toEqual({ method: 'listSessions', args: ['/ws'] });
  });

  it('POST /api/rem/sessions 带 teamId 创建多 Agent session', async () => {
    const { app, fake } = setup();
    const res = await app.request('/api/rem/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 'research' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mode).toBe('multi-agent');
    expect(fake.calls[0]).toEqual({
      method: 'createSession',
      args: [{ workspace: '/ws', teamId: 'research' }],
    });
  });

  it('Core 抛 not found 错误时返回 404', async () => {
    const { app } = setup({ failOn: { listSessions: new Error('Session not found: x') } });
    const res = await app.request('/api/rem/sessions');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('not found');
  });

  it('POST send 内容为空时返回 400', async () => {
    const { app } = setup();
    const res = await app.request('/api/rem/sessions/s1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('content');
  });

  it('POST send 返回 204', async () => {
    const { app } = setup();
    const res = await app.request('/api/rem/sessions/s1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });
    expect(res.status).toBe(204);
  });

  it('POST interrupt 返回 204', async () => {
    const { app } = setup();
    const res = await app.request('/api/rem/sessions/s1/interrupt', { method: 'POST' });
    expect(res.status).toBe(204);
  });
});

describe('teams route', () => {
  it('GET /api/rem/teams 返回 team 列表', async () => {
    const { app } = setup({ teams: [team] });
    const res = await app.request('/api/rem/teams');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([team]);
  });
});
