import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';

describe('AgentService init', () => {
  let dir: string;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-init-test-'));
    service = new AgentService({ workspaceRoot: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds AgentContext on init', async () => {
    await service.init();
    const summary = await service.createSession();
    expect(summary.sessionId).toBeDefined();
    expect(summary.title).toBe('New Chat');
  });

  it('is idempotent', async () => {
    await service.init();
    await service.init();
    const summary = await service.createSession();
    expect(summary.sessionId).toBeDefined();
  });

  it('throws when accessed before init', async () => {
    await expect(service.createSession()).rejects.toThrow(/not initialized/);
  });
});
