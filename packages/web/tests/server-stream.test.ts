import { describe, expect, it } from 'vitest';
import type { AgentSystemEvent } from 'rem-agent-core';
import { createWebApp } from '../src/server/app.js';
import { createFakeAgentSystem } from './helpers/fake-agent-system.js';

const events: AgentSystemEvent[] = [
  { workspace: '/ws', sessionId: 's1', type: 'session-start' },
  { workspace: '/ws', sessionId: 's1', type: 'activity-change', activity: 'thinking' },
];

it('GET /api/rem/stream 以 event: bus 格式推送全部系统事件', async () => {
  const fake = createFakeAgentSystem({ events });
  const app = createWebApp({ system: fake.system, workspace: '/ws' });
  const res = await app.request('/api/rem/stream');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const text = await res.text();
  const frames = text.split('\n\n').filter((f) => f.startsWith('event: bus'));
  expect(frames).toHaveLength(2);
  expect(frames[0]).toContain('"type":"session-start"');
  expect(frames[1]).toContain('"type":"activity-change"');
});
