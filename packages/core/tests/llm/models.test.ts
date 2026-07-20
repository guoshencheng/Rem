import { describe, it, expect } from 'vitest';
import { createCoreModels } from '../../src/llm/models.js';

describe('createCoreModels', () => {
  it('creates empty models when all is false', () => {
    const models = createCoreModels();
    expect(models.getModel('openai', 'gpt-4o')).toBeUndefined();
  });

  it('registers builtin providers when all is true', () => {
    const models = createCoreModels({ all: true });
    const model = models.getModel('openai', 'gpt-4o');
    expect(model).toBeDefined();
    expect(model?.id).toBe('gpt-4o');
  });

  it('throws or returns undefined for unknown model', () => {
    const models = createCoreModels({ all: true });
    expect(models.getModel('unknown', 'unknown')).toBeUndefined();
  });

  it('patches MiniMax anthropic-messages models to force adaptive thinking', () => {
    const models = createCoreModels({ all: true });

    const m3 = models.getModel('minimax', 'MiniMax-M3');
    expect(m3).toBeDefined();
    expect((m3 as any).compat?.forceAdaptiveThinking).toBe(true);

    const m3Cn = models.getModel('minimax-cn', 'MiniMax-M3');
    expect(m3Cn).toBeDefined();
    expect((m3Cn as any).compat?.forceAdaptiveThinking).toBe(true);

    const m2 = models.getModel('minimax', 'MiniMax-M2.7');
    expect((m2 as any).compat?.forceAdaptiveThinking).toBe(true);

    // 非 MiniMax 模型不应被改动
    const openai = models.getModel('openai', 'gpt-4o');
    expect(openai).toBeDefined();
    expect((openai as any).compat?.forceAdaptiveThinking).toBeUndefined();
  });
});
