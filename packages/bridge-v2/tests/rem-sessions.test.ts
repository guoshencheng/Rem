import { describe, expect, it } from 'vitest';
import { REMSessions } from '../src/rem-sessions.js';

describe('REMSessions', () => {
  const publish = () => {};

  it('getOrCreate 幂等，running() 只列 running 的 session', () => {
    const sessions = new REMSessions(publish);
    const a = sessions.getOrCreate('s-1', 'default');
    const b = sessions.getOrCreate('s-1', 'default');
    const c = sessions.getOrCreate('s-2', 'default');
    expect(a).toBe(b);
    expect(sessions.running()).toEqual([]);
    a.startRun();
    expect(sessions.running().map((s) => s.sessionId)).toEqual(['s-1']);
    c.startRun();
    c.finishRun();
    expect(sessions.running().map((s) => s.sessionId)).toEqual(['s-1']);
  });

  it('remove 删除后 get 返回 undefined', () => {
    const sessions = new REMSessions(publish);
    sessions.getOrCreate('s-1', 'default');
    sessions.remove('s-1');
    expect(sessions.get('s-1')).toBeUndefined();
  });
});
