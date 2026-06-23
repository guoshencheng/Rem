import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentServer } from '../src/server.js';

describe('AgentServer', () => {
  let server: AgentServer;

  beforeAll(async () => {
    server = new AgentServer({ port: 18321, host: '127.0.0.1' });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('responds to /api/sessions', async () => {
    const res = await fetch('http://127.0.0.1:18321/api/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
