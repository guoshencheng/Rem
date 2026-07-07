import { describe, it, expect } from 'vitest';
import type { ApprovalDecision } from '../src/sdk/agent-state-provider.js';
import type { AgentLiveProvider } from '../src/sdk/agent-state-provider.js';
import type { ToolHookContext } from '../src/sdk/tool-hook.js';
import type { AgentStreamChunk } from '../src/types.js';
import { AgentLiveState } from '../src/state.js';
import { ApprovalManager } from '../src/security/approval-manager.js';
import { ApprovalOrchestrator } from '../src/security/approval-orchestrator.js';

function createLiveProvider(): AgentLiveProvider {
  const store = new Map<string, AgentLiveState>();
  return {
    get: async (sessionId) => store.get(sessionId),
    set: async (sessionId, state) => { store.set(sessionId, state); },
  };
}

function createEmitter() {
  const chunks: AgentStreamChunk[] = [];
  return {
    chunks,
    emit: (chunk: AgentStreamChunk) => chunks.push(chunk),
  };
}

function createContext(sessionId: string, toolName: string, signal?: AbortSignal): ToolHookContext {
  return {
    cwd: '/tmp',
    workspaceRoot: '/tmp',
    sessionId,
    toolName,
    toolCallId: 'call-1',
    input: {},
    signal,
  };
}

describe('ApprovalOrchestrator', () => {
  it('emits approval-request chunk and persists pending approval', async () => {
    const liveProvider = createLiveProvider();
    const approvalManager = new ApprovalManager();
    const orchestrator = new ApprovalOrchestrator(liveProvider, approvalManager);
    const emitter = createEmitter();
    const ctx = createContext('session-1', 'write-file');

    const promise = orchestrator.requestApproval(
      ctx,
      { title: 'Write file', allowedDecisions: ['allow-once', 'deny'] },
      emitter,
    );

    const pending = approvalManager.listPending();
    expect(pending).toHaveLength(1);

    const resolved = orchestrator.resolveApproval(pending[0].approvalId, 'allow-once');
    expect(resolved).toBe(true);

    const decision = await promise;
    expect(decision).toBe('allow-once');

    const state = await liveProvider.get('session-1');
    expect(state.pendingApprovals).toHaveLength(0);
    expect(emitter.chunks).toHaveLength(2);
    expect(emitter.chunks[0]).toEqual({
      type: 'approval-request',
      sessionId: 'session-1',
      request: pending[0],
    });
    expect(emitter.chunks[1].type).toBe('approval-resolved');
  });

  it('resolveApproval removes pending approval and emits approval-resolved', async () => {
    const liveProvider = createLiveProvider();
    const approvalManager = new ApprovalManager();
    const orchestrator = new ApprovalOrchestrator(liveProvider, approvalManager);
    const emitter = createEmitter();
    const ctx = createContext('session-2', 'delete-file');

    const promise = orchestrator.requestApproval(
      ctx,
      { title: 'Delete file', allowedDecisions: ['allow-once', 'allow-always', 'deny'] },
      emitter,
    );

    const pending = approvalManager.listPending();
    const approvalId = pending[0].approvalId;

    orchestrator.resolveApproval(approvalId, 'deny');
    const decision = await promise;

    const afterState = await liveProvider.get('session-2');
    expect(decision).toBe('deny');
    expect(afterState.pendingApprovals).toHaveLength(0);
    expect(emitter.chunks).toHaveLength(2);
    expect(emitter.chunks[1]).toEqual({
      type: 'approval-resolved',
      sessionId: 'session-2',
      approvalId,
      decision: 'deny',
    });
  });

  it('timeout removes pending approval and emits approval-resolved with null', async () => {
    const liveProvider = createLiveProvider();
    const approvalManager = new ApprovalManager();
    const orchestrator = new ApprovalOrchestrator(liveProvider, approvalManager);
    const emitter = createEmitter();
    const ctx = createContext('session-3', 'exec');

    const decision = await orchestrator.requestApproval(
      ctx,
      { title: 'Run command', allowedDecisions: ['allow-once', 'deny'], timeoutMs: 10 },
      emitter,
    );

    const state = await liveProvider.get('session-3');
    expect(decision).toBeNull();
    expect(state.pendingApprovals).toHaveLength(0);
    expect(emitter.chunks).toHaveLength(2);
    expect(emitter.chunks[1]).toEqual({
      type: 'approval-resolved',
      sessionId: 'session-3',
      approvalId: expect.stringMatching(/^approval:/),
      decision: null,
    });
  });

  it('returns false when resolving unknown approvalId', () => {
    const liveProvider = createLiveProvider();
    const approvalManager = new ApprovalManager();
    const orchestrator = new ApprovalOrchestrator(liveProvider, approvalManager);

    expect(orchestrator.resolveApproval('approval:unknown', 'allow-once')).toBe(false);
  });

  it('rejects promptly when the abort signal is already aborted', async () => {
    const liveProvider = createLiveProvider();
    const approvalManager = new ApprovalManager();
    const orchestrator = new ApprovalOrchestrator(liveProvider, approvalManager);
    const emitter = createEmitter();
    const controller = new AbortController();
    controller.abort();
    const ctx = createContext('session-4', 'write-file', controller.signal);

    await expect(
      orchestrator.requestApproval(
        ctx,
        { title: 'Write file', allowedDecisions: ['allow-once', 'deny'] },
        emitter,
      ),
    ).rejects.toThrow('Approval aborted');

    const state = await liveProvider.get('session-4');
    expect(state.pendingApprovals).toHaveLength(0);
    expect(emitter.chunks).toHaveLength(2);
    expect(emitter.chunks[1]).toEqual({
      type: 'approval-resolved',
      sessionId: 'session-4',
      approvalId: expect.stringMatching(/^approval:/),
      decision: null,
    });
  });

  it('rejects and emits approval-resolved when aborted while waiting', async () => {
    const liveProvider = createLiveProvider();
    const approvalManager = new ApprovalManager();
    const orchestrator = new ApprovalOrchestrator(liveProvider, approvalManager);
    const emitter = createEmitter();
    const controller = new AbortController();
    const ctx = createContext('session-5', 'write-file', controller.signal);

    const promise = orchestrator.requestApproval(
      ctx,
      { title: 'Write file', allowedDecisions: ['allow-once', 'deny'] },
      emitter,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    await expect(promise).rejects.toThrow('Approval aborted');

    const state = await liveProvider.get('session-5');
    expect(state.pendingApprovals).toHaveLength(0);
    expect(emitter.chunks).toHaveLength(2);
    expect(emitter.chunks[1]).toEqual({
      type: 'approval-resolved',
      sessionId: 'session-5',
      approvalId: expect.stringMatching(/^approval:/),
      decision: null,
    });
  });
});
