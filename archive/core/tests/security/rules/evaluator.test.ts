import { describe, it, expect } from 'vitest';
import { evaluate, type ToolCallPattern } from '../../../src/security/rules/evaluator.js';
import type { Rule } from '../../../src/security/rules/rule.js';

describe('evaluate', () => {
  const call: ToolCallPattern = {
    toolName: 'exec',
    input: { command: 'git status' },
    derivedPatterns: ['bash:git status', 'bash:git *'],
  };

  it('returns allow when rule matches', () => {
    const rules: Rule[] = [{ permission: 'exec', pattern: 'bash:git *', action: 'allow', source: 'profile' }];
    expect(evaluate(call, rules)).toBe('allow');
  });

  it('returns deny when deny rule matches', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: 'bash:*', action: 'allow', source: 'profile' },
      { permission: 'exec', pattern: 'bash:rm *', action: 'deny', source: 'user-config' },
    ];
    const rmCall: ToolCallPattern = {
      toolName: 'exec',
      input: { command: 'rm -rf /' },
      derivedPatterns: ['bash:rm -rf /', 'bash:rm *'],
    };
    expect(evaluate(rmCall, rules)).toBe('deny');
  });

  it('defaults to ask when no rule matches', () => {
    expect(evaluate(call, [])).toBe('ask');
  });

  it('uses last matching rule', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: 'bash:git *', action: 'deny', source: 'default' },
      { permission: 'exec', pattern: 'bash:git *', action: 'allow', source: 'profile' },
    ];
    expect(evaluate(call, rules)).toBe('allow');
  });
});
