import { describe, it, expect } from 'vitest';
import { ToolDeniedError } from '../../../src/security/rules/errors.js';

describe('ToolDeniedError', () => {
  it('encapsulates denial reason', () => {
    const err = new ToolDeniedError('exec', 'rule');
    expect(err.toolName).toBe('exec');
    expect(err.reason).toBe('rule');
    expect(err.message).toContain('denied');
  });
});
