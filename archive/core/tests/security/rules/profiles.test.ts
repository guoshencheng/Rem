import { describe, it, expect } from 'vitest';
import { getProfileRules } from '../../../src/security/rules/profiles.js';

describe('getProfileRules', () => {
  it('coding profile allows safe read tools', () => {
    const rules = getProfileRules('coding');
    expect(rules.some((r) => r.permission === 'read' && r.action === 'allow')).toBe(true);
  });

  it('minimal profile only allows session_status', () => {
    const rules = getProfileRules('minimal');
    expect(rules.every((r) => r.permission === 'session_status')).toBe(true);
  });

  it('returns empty for unknown profile', () => {
    expect(getProfileRules('unknown' as any)).toEqual([]);
  });
});
