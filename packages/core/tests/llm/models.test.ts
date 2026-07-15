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
});
