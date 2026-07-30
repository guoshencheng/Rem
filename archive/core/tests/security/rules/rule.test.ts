import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { RuleSchema, isRuleAction } from '../../../src/security/rules/rule.js';

describe('rule schema', () => {
  it('validates a correct rule', () => {
    const rule = { permission: 'exec', pattern: 'git *', action: 'allow' };
    expect(Value.Check(RuleSchema, rule)).toBe(true);
  });

  it('rejects invalid action', () => {
    const rule = { permission: 'exec', pattern: '*', action: 'maybe' };
    expect(Value.Check(RuleSchema, rule)).toBe(false);
  });

  it('isRuleAction narrows types', () => {
    expect(isRuleAction('allow')).toBe(true);
    expect(isRuleAction('ask')).toBe(true);
    expect(isRuleAction('deny')).toBe(true);
    expect(isRuleAction('once')).toBe(false);
  });

  it('accepts a rule with outside=true', () => {
    const rule = {
      permission: 'read',
      pattern: '*',
      action: 'allow',
      outside: true,
    };
    expect(Value.Check(RuleSchema, rule)).toBe(true);
  });

  it('accepts a rule without outside field', () => {
    const rule = {
      permission: 'read',
      pattern: '*',
      action: 'allow',
    };
    expect(Value.Check(RuleSchema, rule)).toBe(true);
  });

  it('rejects a rule with non-boolean outside', () => {
    const rule = {
      permission: 'read',
      pattern: '*',
      action: 'allow',
      outside: 'yes',
    };
    expect(Value.Check(RuleSchema, rule)).toBe(false);
  });
});
