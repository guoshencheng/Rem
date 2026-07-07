import { describe, it, expect, vi } from 'vitest';
import { createDefaultAgentPaths, resolveTilde } from '../../src/config/paths.js';

describe('createDefaultAgentPaths', () => {
  it('should create paths with defaults', () => {
    vi.stubEnv('REM_AGENT_HOME', '');
    vi.stubEnv('REM_AGENT_DIR', '');
    const paths = createDefaultAgentPaths();
    expect(paths.agentDir).toContain('.rem-agent');
    expect(paths.homeSkillsDir).toContain('.agents/skills');
    expect(paths.sessionsDir).toContain('.rem-agent/sessions');
  });

  it('should respect REM_AGENT_HOME', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_HOME: '/custom/home' } });
    expect(paths.agentDir).toBe('/custom/home');
    expect(paths.sessionsDir).toBe('/custom/home/sessions');
  });

  it('should allow overriding agentDir', () => {
    const paths = createDefaultAgentPaths({ agentDir: '/tmp/test-agent' });
    expect(paths.agentDir).toBe('/tmp/test-agent');
    expect(paths.sessionsDir).toBe('/tmp/test-agent/sessions');
  });

  it('should allow overriding homeSkillsDir and sessionsDir', () => {
    const paths = createDefaultAgentPaths({
      homeSkillsDir: '/custom/skills',
      sessionsDir: '/custom/sessions',
    });
    expect(paths.homeSkillsDir).toBe('/custom/skills');
    expect(paths.sessionsDir).toBe('/custom/sessions');
  });

  it('should resolve ~ in REM_AGENT_HOME', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_HOME: '~/my-agent' } });
    expect(paths.agentDir).not.toContain('~');
    expect(paths.agentDir).toContain('my-agent');
  });

  it('workspaceSkillsDir should return correct path', () => {
    const paths = createDefaultAgentPaths({ agentDir: '/tmp/a' });
    expect(paths.workspaceSkillsDir('/root')).toBe('/root/.agents/skills');
  });

  it('configCandidates should return candidates in priority order', () => {
    const paths = createDefaultAgentPaths({ agentDir: '/tmp/a' });
    const candidates = paths.configCandidates('/cwd');
    expect(candidates).toHaveLength(6);
    expect(candidates[0]).toBe('/cwd/rem-agent.config.json');
    expect(candidates[1]).toBe('/cwd/rem-agent.config.yaml');
    expect(candidates[2]).toBe('/cwd/rem-agent.config.yml');
    expect(candidates[3]).toBe('/tmp/a/config.json');
    expect(candidates[4]).toBe('/tmp/a/config.yaml');
    expect(candidates[5]).toBe('/tmp/a/config.yml');
  });

  it('debugLogFile should be null by default', () => {
    const paths = createDefaultAgentPaths({ env: {} });
    expect(paths.debugLogFile).toBeNull();
  });

  it('debugLogFile should return REM_AGENT_DEBUG_FILE if set', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_DEBUG_FILE: '/tmp/debug.log' } });
    expect(paths.debugLogFile).toBe('/tmp/debug.log');
  });

  it('debugLogFile should return /tmp/rem-agent-debug.log when REM_AGENT_DEBUG=1', () => {
    const paths = createDefaultAgentPaths({
      env: { REM_AGENT_DEBUG: '1', REM_AGENT_DEBUG_FILE: undefined },
    });
    expect(paths.debugLogFile).toBe('/tmp/rem-agent-debug.log');
  });
});

describe('resolveTilde', () => {
  it('should expand leading tilde', () => {
    const result = resolveTilde('~/foo');
    expect(result).not.toContain('~');
    expect(result).toContain('foo');
  });

  it('should not modify absolute paths', () => {
    expect(resolveTilde('/absolute/foo')).toBe('/absolute/foo');
  });
});
