import { describe, it, expect } from 'vitest';
import { InteractivePermissionEvaluator } from '../../../src/security/permissions/interactive-evaluator.js';
import { BaseRuleEvaluator } from '../../../src/security/permissions/base-evaluator.js';
import { RuleEngine } from '../../../src/security/rules/rule-engine.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../../../src/sdk/tool-provider.js';
import type { Rule, ApprovalRequestInput } from '../../../src/security/permissions/types.js';

const writeDef: ToolDefinition = {
  name: 'write',
  description: 'write',
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
  deriveAlwaysOptions: (input: { path: string }) => [
    { label: input.path, rule: { permission: 'write', pattern: input.path, action: 'allow' } },
  ],
};

const readDef: ToolDefinition = {
  name: 'read',
  description: 'read',
  parameters: Type.Object({ path: Type.String() }),
  readOnly: true,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

function createEvaluator(rules: Rule[]) {
  return new InteractivePermissionEvaluator(new BaseRuleEvaluator(new RuleEngine(rules)), {
    create: (input: ApprovalRequestInput) => input,
  });
}

describe('InteractivePermissionEvaluator', () => {
  it('allows when rule matches allow', async () => {
    const evaluator = createEvaluator([
      { permission: 'write', pattern: 'file:src/*', action: 'allow', source: 'user-config' },
    ]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('denies when rule matches deny', async () => {
    const evaluator = createEvaluator([
      { permission: 'write', pattern: 'file:src/*', action: 'deny', source: 'user-config' },
    ]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision).toEqual({ action: 'deny', reason: 'denied by rule' });
  });

  it('asks for write when no rule matches', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision.action).toBe('ask');
    expect((decision as any).request.toolName).toBe('write');
  });

  it('allows ordinary read without asking', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: 'src/foo.ts' } },
      readDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('asks for sensitive read', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: '.env' } },
      readDef,
    );
    expect(decision.action).toBe('ask');
  });
});
