import { describe, it, expect } from 'vitest';
import { buildRuleSet } from '../../../src/security/rules/ruleset.js';
import type { Rule } from '../../../src/security/rules/rule.js';
import { matchPattern } from '../../../src/security/rules/matcher.js';

describe('buildRuleSet', () => {
  it('orders rules by source priority', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: '*', action: 'ask', source: 'default' },
      { permission: 'exec', pattern: 'git *', action: 'allow', source: 'profile' },
      { permission: 'exec', pattern: 'git status', action: 'deny', source: 'user-config' },
    ];
    const set = buildRuleSet(rules);
    // Descending order: lower priority number (higher priority) comes LAST
    // so findLast finds higher-priority rules first
    expect(set[0].source).toBe('default');
    expect(set[1].source).toBe('profile');
    expect(set[2].source).toBe('user-config');
  });

  it('uses findLast semantics', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: '*', action: 'ask', source: 'default' },
      { permission: 'exec', pattern: 'git *', action: 'allow', source: 'profile' },
    ];
    const set = buildRuleSet(rules);
    const matched = set.findLast((r) => r.permission === 'exec' && matchPattern('git status', r.pattern));
    expect(matched?.action).toBe('allow');
  });

  it('findLast returns the most specific match when patterns differ', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: '*', action: 'ask', source: 'default' },
      { permission: 'exec', pattern: 'git *', action: 'allow', source: 'profile' },
      { permission: 'exec', pattern: 'git status', action: 'deny', source: 'user-config' },
    ];
    const set = buildRuleSet(rules);
    const matched = set.findLast((r) => r.permission === 'exec' && matchPattern('git status', r.pattern));
    expect(matched?.action).toBe('deny');
  });
});
