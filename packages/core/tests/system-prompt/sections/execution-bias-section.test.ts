import { describe, it, expect } from 'vitest';
import { ExecutionBiasSection } from '../../../src/system-prompt/sections/execution-bias-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const ctx = {} as PromptBuildContext;

describe('ExecutionBiasSection', () => {
  it('contains key execution bias instructions', () => {
    const section = new ExecutionBiasSection();
    const result = section.render(ctx);
    expect(result).toContain('## Execution Bias');
    expect(result).toContain('Actionable request: act in this turn');
    expect(result).toContain('Continue until done or genuinely blocked');
    expect(result).toContain('Final answer needs evidence');
  });
});
