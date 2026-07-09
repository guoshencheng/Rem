import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalEngine } from '../../src/execute/approval-engine.js';
import type { Rule } from '../../src/security/rules/rule.js';

describe('ApprovalEngine', () => {
  let engine: ApprovalEngine;

  beforeEach(() => {
    engine = new ApprovalEngine('session-1');
  });

  it('creates a request', () => {
    const req = engine.createRequest({
      toolCallId: 'tc-1',
      toolName: 'write',
      patterns: ['file:src/foo.ts'],
      alwaysOptions: [
        { label: 'src/foo.ts', rule: { permission: 'write', pattern: 'src/foo.ts', action: 'allow' } },
      ],
    });
    expect(req.approvalId).toBeDefined();
    expect(req.toolName).toBe('write');
  });

  it('resolves once without persisting rule', async () => {
    const req = engine.createRequest({ toolCallId: 'tc-1', toolName: 'write', patterns: ['file:src/foo.ts'], alwaysOptions: [] });
    const promise = engine.wait(req.approvalId);
    engine.resolve(req.approvalId, 'allow-once');
    const res = await promise;
    expect(res.decision).toBe('allow-once');
    expect(res.rule).toBeUndefined();
  });

  it('resolves always with a rule', async () => {
    const rule: Omit<Rule, 'source'> = { permission: 'write', pattern: '*.ts', action: 'allow' };
    const req = engine.createRequest({ toolCallId: 'tc-1', toolName: 'write', patterns: ['file:src/foo.ts'], alwaysOptions: [{ label: '*.ts', rule }] });
    const promise = engine.wait(req.approvalId);
    engine.resolve(req.approvalId, 'allow-always', rule);
    const res = await promise;
    expect(res.decision).toBe('allow-always');
    expect(res.rule).toEqual(rule);
  });

  it('does not timeout', async () => {
    const req = engine.createRequest({ toolCallId: 'tc-1', toolName: 'write', patterns: [], alwaysOptions: [] });
    const promise = engine.wait(req.approvalId);
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.isPending(req.approvalId)).toBe(true);
    engine.resolve(req.approvalId, 'deny');
    await expect(promise).resolves.toEqual({ decision: 'deny' });
  });

  it('denies all pending', async () => {
    const req1 = engine.createRequest({ toolCallId: 'tc-1', toolName: 'write', patterns: [], alwaysOptions: [] });
    const req2 = engine.createRequest({ toolCallId: 'tc-2', toolName: 'write', patterns: [], alwaysOptions: [] });
    const p1 = engine.wait(req1.approvalId);
    const p2 = engine.wait(req2.approvalId);
    engine.denyAll();
    await expect(p1).resolves.toEqual({ decision: 'deny' });
    await expect(p2).resolves.toEqual({ decision: 'deny' });
  });
});
