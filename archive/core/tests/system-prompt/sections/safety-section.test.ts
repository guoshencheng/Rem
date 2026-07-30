import { describe, it, expect } from 'vitest';
import { SafetySection } from '../../../src/system-prompt/sections/safety-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const ctx = {} as PromptBuildContext;

describe('SafetySection', () => {
  it('contains safety boundary instructions', () => {
    const section = new SafetySection();
    const result = section.render(ctx);
    expect(result).toContain('## Safety');
    expect(result).toContain('No independent goals');
    expect(result).toContain('Before changing config or schedulers');
  });
});
