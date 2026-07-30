import { describe, it, expect } from 'vitest';
import { AutoPermissionEvaluator } from '../../../src/security/permissions/auto-evaluator.js';
import { BaseRuleEvaluator } from '../../../src/security/permissions/base-evaluator.js';
import { RuleEngine } from '../../../src/security/rules/rule-engine.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../../../src/sdk/tool-provider.js';
import type { Rule } from '../../../src/security/rules/rule.js';

const writeDef: ToolDefinition = {
  name: 'write',
  description: 'write',
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

const readDef: ToolDefinition = {
  name: 'read',
  description: 'read',
  parameters: Type.Object({ path: Type.String() }),
  readOnly: true,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

function createEvaluator(rules: Rule[]) {
  return new AutoPermissionEvaluator(new BaseRuleEvaluator(new RuleEngine(rules)));
}

describe('AutoPermissionEvaluator', () => {
  it('allows write when no rule matches', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('denies write when rule matches deny', async () => {
    const evaluator = createEvaluator([
      { permission: 'write', pattern: 'file:src/*', action: 'deny', source: 'user-config' },
    ]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision).toEqual({ action: 'deny', reason: 'denied by rule' });
  });

  it('allows ordinary read without rule', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: 'src/foo.ts' } },
      readDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('denies sensitive read', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: '.env' } },
      readDef,
    );
    expect(decision).toEqual({ action: 'deny', reason: 'sensitive read blocked in auto mode' });
  });

  it('allows sensitive read when rule matches allow', async () => {
    const evaluator = createEvaluator([
      { permission: 'read', pattern: 'file:.env', action: 'allow', source: 'user-config' },
    ]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: '.env' } },
      readDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });
});
