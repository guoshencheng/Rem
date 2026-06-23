import { describe, it, expect } from 'vitest';
import { expandToolGroups, normalizeToolName, TOOL_GROUPS } from '../src/security/tool-policy-shared.js';
import { resolveProfilePolicy } from '../src/security/tool-policy-profile.js';

describe('tool-policy-shared', () => {
  it('normalizes tool names to lowercase', () => {
    expect(normalizeToolName('Read')).toBe('read');
    expect(normalizeToolName('  Write  ')).toBe('write');
  });

  it('expands group entries', () => {
    expect(expandToolGroups(['group:fs'])).toEqual(['read', 'write', 'edit']);
  });

  it('keeps non-group entries as-is', () => {
    expect(expandToolGroups(['read', 'custom_tool'])).toEqual(['read', 'custom_tool']);
  });

  it('returns empty array for undefined', () => {
    expect(expandToolGroups(undefined)).toEqual([]);
  });
});

describe('tool-policy-profile', () => {
  it('resolves coding profile', () => {
    const policy = resolveProfilePolicy('coding');
    expect(policy.allow?.sort()).toEqual([
      'edit',
      'exec',
      'memory_get',
      'memory_search',
      'process',
      'read',
      'sessions_history',
      'sessions_list',
      'sessions_send',
      'sessions_spawn',
      'web_fetch',
      'web_search',
      'write',
    ]);
  });

  it('resolves minimal profile', () => {
    const policy = resolveProfilePolicy('minimal');
    expect(policy.allow).toEqual(['session_status']);
  });

  it('resolves full profile as no restriction', () => {
    const policy = resolveProfilePolicy('full');
    expect(policy.allow).toBeUndefined();
  });
});
