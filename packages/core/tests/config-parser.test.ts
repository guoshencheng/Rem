import { describe, it, expect } from 'vitest';
import { pickAgents, pickCustomAgentConfig } from '../src/plugins/config/default/config-parser.js';
import { mergeFileConfig, mergeDeepConfig, mergeOverrides } from '../src/plugins/config/default/config-merger.js';

describe('pickCustomAgentConfig', () => {
  it('returns valid config with optional model', () => {
    const result = pickCustomAgentConfig({
      name: 'Coder',
      corePrompt: 'Write code.',
      model: { provider: 'openai', model: 'gpt-4o' },
    });
    expect(result).toEqual({
      name: 'Coder',
      corePrompt: 'Write code.',
      model: { provider: 'openai', model: 'gpt-4o' },
    });
  });

  it('returns undefined when name is missing', () => {
    const result = pickCustomAgentConfig({ corePrompt: 'Write code.' });
    expect(result).toBeUndefined();
  });

  it('returns undefined when corePrompt is missing', () => {
    const result = pickCustomAgentConfig({ name: 'Coder' });
    expect(result).toBeUndefined();
  });
});

describe('pickAgents', () => {
  it('returns valid agents map', () => {
    const result = pickAgents({
      coder: { name: 'Coder', corePrompt: 'Write code.', model: { provider: 'openai', model: 'gpt-4o' } },
      invalid: { name: 'OnlyName' },
    });
    expect(result).toHaveProperty('coder');
    expect(result).not.toHaveProperty('invalid');
    expect(result!.coder.name).toBe('Coder');
    expect(result!.coder.corePrompt).toBe('Write code.');
    expect(result!.coder.model).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });
});

describe('mergeFileConfig agents', () => {
  it('merges agents from file', () => {
    const merged = mergeFileConfig({}, { agents: { coder: { name: 'Coder', corePrompt: 'Code.' } } });
    expect(merged.agents?.coder.name).toBe('Coder');
  });
});

describe('mergeDeepConfig agents', () => {
  it('deep-merges agents from workspace over home', () => {
    const base = { agents: { default: { name: 'Home', corePrompt: 'Home default.' } } };
    const merged = mergeDeepConfig(base, { agents: { coder: { name: 'Coder', corePrompt: 'Code.' } } });
    expect(merged.agents?.default.name).toBe('Home');
    expect(merged.agents?.coder.name).toBe('Coder');
  });
});

describe('mergeOverrides agents', () => {
  it('merges agents from overrides', () => {
    const base = { agents: { default: { name: 'Base', corePrompt: 'Base default.' } } };
    const merged = mergeOverrides(base as any, { agents: { coder: { name: 'Coder', corePrompt: 'Code.' } } });
    expect(merged.agents?.default.name).toBe('Base');
    expect(merged.agents?.coder.name).toBe('Coder');
  });
});
