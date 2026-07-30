import { describe, it, expect } from 'vitest';
import { classifyCommand, SAFE_BINS } from '../../../src/security/exec-classifier.js';

describe('classifyCommand', () => {
  it('classifies safe bins as safe', () => {
    const c = classifyCommand('ls -la');
    expect(c.risk).toBe('safe');
    expect(c.baseCommand).toBe('ls');
  });

  it('classifies git status as safe', () => {
    const c = classifyCommand('git status');
    expect(c.risk).toBe('safe');
    expect(c.baseCommand).toBe('git');
  });

  it('classifies rm as dangerous', () => {
    const c = classifyCommand('rm -rf node_modules');
    expect(c.risk).toBe('dangerous');
  });

  it('classifies pipes as complex', () => {
    const c = classifyCommand('cat file | grep x');
    expect(c.risk).toBe('complex');
  });

  it('classifies bash -c as complex', () => {
    const c = classifyCommand('bash -c "rm -rf /"');
    expect(c.risk).toBe('complex');
  });

  it('generates always options for safe command', () => {
    const c = classifyCommand('git status');
    expect(c.patterns).toContain('bash:git status');
    expect(c.patterns).toContain('bash:git *');
  });
});
