import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  resolveProvider,
  listProviders,
  clearProviders,
  type LLMProvider,
} from '../../src/llm/api-registry.js';

const mockProvider: LLMProvider = {
  generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
  stream: async function* () { yield { type: 'finish', reason: 'stop' }; },
};

describe('ApiRegistry', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('should register and resolve provider', () => {
    registerProvider('mock', mockProvider);
    expect(resolveProvider('mock')).toBe(mockProvider);
  });

  it('should list registered providers', () => {
    registerProvider('a', mockProvider);
    registerProvider('b', mockProvider);
    expect(listProviders().sort()).toEqual(['a', 'b']);
  });

  it('should throw on unknown provider', () => {
    expect(() => resolveProvider('unknown')).toThrow('Unknown provider');
  });

  it('should throw on duplicate registration', () => {
    registerProvider('mock', mockProvider);
    expect(() => registerProvider('mock', mockProvider)).toThrow('already registered');
  });
});
