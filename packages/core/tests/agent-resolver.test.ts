import { describe, it, expect } from 'vitest';
import { DefaultAgentResolver } from '../src/agent-resolver.js';

const baseBehavior = {
  name: 'Rem Agent',
  maxTurns: 60,
  workspaceRoot: '/tmp',
  readOnly: false,
  autoApproveDangerous: false,
  sessionsDir: '/tmp/sessions',
  profile: 'coding' as const,
  sessionRules: [],
};

describe('DefaultAgentResolver', () => {
  it('returns default role when no id is given', () => {
    const resolver = new DefaultAgentResolver({ behavior: baseBehavior });
    const role = resolver.resolveAgent();
    expect(role.id).toBe('default');
    expect(role.name).toBe('Rem Agent');
  });

  it('returns custom agent when id matches', () => {
    const resolver = new DefaultAgentResolver({
      behavior: baseBehavior,
      agents: {
        coder: { name: 'Code Assistant', corePrompt: 'Focus on code.' },
      },
      resolveModel: () => undefined,
    });
    const role = resolver.resolveAgent('coder');
    expect(role.id).toBe('coder');
    expect(role.name).toBe('Code Assistant');
    expect(role.corePrompt).toBe('Focus on code.');
  });

  it('falls back to default for unknown id', () => {
    const resolver = new DefaultAgentResolver({ behavior: baseBehavior });
    const role = resolver.resolveAgent('unknown');
    expect(role.id).toBe('default');
  });

  it('skips invalid agent missing corePrompt', () => {
    const resolver = new DefaultAgentResolver({
      behavior: baseBehavior,
      agents: {
        bad: { name: 'Bad', corePrompt: '' },
      } as any,
      resolveModel: () => undefined,
    });
    const role = resolver.resolveAgent('bad');
    expect(role.id).toBe('default');
  });

  it('overrides default when agents.default is provided', () => {
    const resolver = new DefaultAgentResolver({
      behavior: baseBehavior,
      agents: {
        default: { name: 'Custom Default', corePrompt: 'Custom default prompt.' },
      },
      resolveModel: () => undefined,
    });
    const role = resolver.resolveAgent();
    expect(role.name).toBe('Custom Default');
    expect(role.corePrompt).toBe('Custom default prompt.');
  });

  it('resolves model override when provided', () => {
    const resolver = new DefaultAgentResolver({
      behavior: baseBehavior,
      agents: {
        coder: {
          name: 'Code Assistant',
          corePrompt: 'Focus on code.',
          model: { provider: 'openai', model: 'gpt-4o' },
        },
      },
      resolveModel: (model) => model ? { provider: model.provider, model: model.model, apiKey: 'key' } : undefined,
    });
    const role = resolver.resolveAgent('coder');
    expect(role.model).toEqual({ provider: 'openai', model: 'gpt-4o', apiKey: 'key' });
  });
});
