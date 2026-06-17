import { describe, it, expect, vi } from 'vitest';
import { getRemAgentDir, getDefaultSkillsDir, getDefaultSessionsDir, resolveTilde } from '../../src/config/paths.js';

describe('paths', () => {
  it('should default to ~/.rem-agent', () => {
    vi.stubEnv('REM_AGENT_HOME', '');
    vi.stubEnv('REM_AGENT_DIR', '');
    expect(getRemAgentDir()).toContain('.rem-agent');
  });

  it('should respect REM_AGENT_HOME', () => {
    vi.stubEnv('REM_AGENT_HOME', '/custom/home');
    expect(getRemAgentDir()).toBe('/custom/home');
  });

  it('should respect REM_AGENT_DIR', () => {
    vi.stubEnv('REM_AGENT_HOME', '');
    vi.stubEnv('REM_AGENT_DIR', '/another/dir');
    expect(getRemAgentDir()).toBe('/another/dir');
  });

  it('should resolve tilde paths', () => {
    vi.stubEnv('REM_AGENT_HOME', '~/custom-agent');
    expect(getRemAgentDir()).not.toContain('~');
    expect(getRemAgentDir()).toContain('custom-agent');
  });

  it('should return default skills dir', () => {
    vi.stubEnv('REM_AGENT_HOME', '/agent');
    expect(getDefaultSkillsDir()).toBe('/agent/skills');
  });

  it('should return default sessions dir', () => {
    vi.stubEnv('REM_AGENT_HOME', '/agent');
    expect(getDefaultSessionsDir()).toBe('/agent/sessions');
  });

  it('resolveTilde should expand leading tilde only', () => {
    const home = process.env.HOME ?? '/mock-home';
    expect(resolveTilde('~/foo')).toBe(`${home}/foo`);
    expect(resolveTilde('/absolute/foo')).toBe('/absolute/foo');
  });
});
