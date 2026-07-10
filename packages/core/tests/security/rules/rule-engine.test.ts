import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../../src/security/rules/rule-engine.js';
import type { Rule } from '../../../src/security/rules/rule.js';

describe('RuleEngine.checkOutsideAllowed', () => {
  it('returns true when outside allow rule matches', () => {
    const engine = new RuleEngine([
      { permission: 'read', pattern: '**', action: 'allow', outside: true, source: 'user-config' } as Rule,
    ]);
    expect(engine.checkOutsideAllowed('read', ['file:/outside/path'])).toBe(true);
  });

  it('returns false when no outside rule matches', () => {
    const engine = new RuleEngine([]);
    expect(engine.checkOutsideAllowed('read', ['file:/outside/path'])).toBe(false);
  });

  it('returns false when outside rule is deny', () => {
    const engine = new RuleEngine([
      { permission: 'read', pattern: '**', action: 'deny', outside: true, source: 'user-config' } as Rule,
    ]);
    expect(engine.checkOutsideAllowed('read', ['file:/outside/path'])).toBe(false);
  });

  it('ignores non-outside rules', () => {
    const engine = new RuleEngine([
      { permission: 'read', pattern: '*', action: 'allow', source: 'user-config' } as Rule,
    ]);
    expect(engine.checkOutsideAllowed('read', ['file:/outside/path'])).toBe(false);
  });
});
