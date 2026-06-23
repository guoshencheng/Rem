import { describe, it, expect } from 'vitest';
import { ApprovalManager } from '../src/security/approval-manager.js';

describe('ApprovalManager', () => {
  it('creates pending approval', () => {
    const manager = new ApprovalManager();
    const handle = manager.create({
      toolName: 'write',
      title: 'Write file',
      allowedDecisions: ['allow-once', 'deny'],
    });
    expect(handle.request.approvalId).toMatch(/^approval:/);
    expect(manager.listPending()).toHaveLength(1);
  });

  it('resolves approval', async () => {
    const manager = new ApprovalManager();
    const handle = manager.create({
      toolName: 'write',
      title: 'Write file',
      allowedDecisions: ['allow-once', 'deny'],
    });
    const decisionPromise = handle.waitForDecision();
    manager.resolve(handle.request.approvalId, 'allow-once');
    const decision = await decisionPromise;
    expect(decision).toBe('allow-once');
  });

  it('times out', async () => {
    const manager = new ApprovalManager();
    const handle = manager.create(
      { toolName: 'write', title: 'Write file', allowedDecisions: ['allow-once', 'deny'] },
      10,
    );
    const decision = await handle.waitForDecision();
    expect(decision).toBeNull();
  });

  it('returns false when resolving unknown approval', () => {
    const manager = new ApprovalManager();
    expect(manager.resolve('approval:unknown', 'allow-once')).toBe(false);
  });
});
