import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AgentService } from '../src/agent.js';
import { JsonWorkspaceRepository } from '../src/workspace-repository-json.js';
import type { IAgentService } from '../src/agent-service.interface.js';

async function makeService(): Promise<{ service: IAgentService; tmpDir: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-svc-'));
  const repo = new JsonWorkspaceRepository(path.join(tmpDir, 'workspaces.json'));
  const service = new AgentService({ sessionsDir: path.join(tmpDir, 'sessions') }, repo);
  await service.init();
  return { service, tmpDir };
}

describe('AgentService workspace', () => {
  it('lists, adds and removes workspaces', async () => {
    const { service, tmpDir } = await makeService();
    expect(await service.listWorkspaces()).toEqual([]);

    const ws = await service.addWorkspace(tmpDir);
    expect(ws.path).toBe(tmpDir);

    const list = await service.listWorkspaces();
    expect(list).toHaveLength(1);

    await service.removeWorkspace(tmpDir);
    expect(await service.listWorkspaces()).toEqual([]);
  });

  it('passes workspace to createSession and listSessions', async () => {
    const { service, tmpDir } = await makeService();
    const ws = await service.addWorkspace(tmpDir);
    const session = await service.createSession(ws.path);
    expect(session.workspace).toBe(ws.path);

    const list = await service.listSessions(ws.path);
    expect(list).toHaveLength(1);
    expect(list[0].workspace).toBe(ws.path);
  });

  it('isolates sessions between workspaces', async () => {
    const { service, tmpDir } = await makeService();
    const subDir = path.join(tmpDir, 'sub');
    await fs.mkdir(subDir, { recursive: true });

    const wsA = await service.addWorkspace(tmpDir);
    const wsB = await service.addWorkspace(subDir);

    await service.createSession(wsA.path);
    await service.createSession(wsB.path);

    const listA = await service.listSessions(wsA.path);
    const listB = await service.listSessions(wsB.path);

    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
    expect(listA[0].sessionId).not.toBe(listB[0].sessionId);
  });
});
