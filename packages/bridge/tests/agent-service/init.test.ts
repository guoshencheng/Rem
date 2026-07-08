import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../../src/agent.js';
import { JsonWorkspaceRepository } from '../../src/workspace-repository-json.js';

const DEFAULT_WORKSPACE = 'default';

const GUARDED_METHODS = [
  { name: 'run', call: (s: AgentService) => s.run(DEFAULT_WORKSPACE, 's1', 'hi') },
  { name: 'createSession', call: (s: AgentService) => s.createSession(DEFAULT_WORKSPACE) },
  { name: 'listSessions', call: (s: AgentService) => s.listSessions(DEFAULT_WORKSPACE) },
  { name: 'getMessages', call: (s: AgentService) => s.getMessages(DEFAULT_WORKSPACE, 's1') },
  { name: 'updateSession', call: (s: AgentService) => s.updateSession(DEFAULT_WORKSPACE, 's1', { title: 'X' }) },
  { name: 'deleteSession', call: (s: AgentService) => s.deleteSession(DEFAULT_WORKSPACE, 's1') },
  { name: 'listPendingApprovals', call: (s: AgentService) => s.listPendingApprovals(DEFAULT_WORKSPACE, 's1') },
];

describe('AgentService init', { timeout: 20000 }, () => {
  let dir: string;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-init-test-'));
    const repo = new JsonWorkspaceRepository(join(dir, 'workspaces.json'));
    service = new AgentService({ workspaceRoot: dir, sessionsDir: dir }, repo);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds AgentContext on init', async () => {
    await service.init();
    const summary = await service.createSession(DEFAULT_WORKSPACE);
    expect(summary.sessionId).toBeDefined();
    expect(summary.title).toBe('New Chat');
  });

  it('is idempotent', async () => {
    await service.init();
    await service.init();
    const summary = await service.createSession(DEFAULT_WORKSPACE);
    expect(summary.sessionId).toBeDefined();
  });

  it.each(GUARDED_METHODS)('throws 503 when $name is called before init', async ({ call }) => {
    await expect(call(service)).rejects.toThrow(/not initialized/);
  });
});
