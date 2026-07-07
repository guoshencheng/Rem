import { describe, it, expect } from 'vitest';
import type { ToolComposer } from '../src/sdk/tool-composer.js';
import type { ToolProvider } from '../src/sdk/tool-provider.js';
import type { SkillProvider } from '../src/sdk/skill-provider.js';

describe('ToolComposer interface', () => {
  it('can be implemented with the expected signature', () => {
    const composer: ToolComposer = {
      compose({ toolProvider, mcpProviders, skillProvider }): ToolProvider {
        void toolProvider;
        void mcpProviders;
        void skillProvider;
        return { getToolSet: () => ({}), execute: async () => [], register: () => {}, isDangerous: () => false };
      },
    };

    expect(composer).toBeDefined();
    expect(typeof composer.compose).toBe('function');
  });
});
