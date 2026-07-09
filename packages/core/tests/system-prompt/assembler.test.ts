import { describe, it, expect } from 'vitest';
import { DefaultSystemPromptAssembler } from '../../src/system-prompt/assembler.js';
import type { PromptBuildContext, AgentPromptTemplateSelector, PromptSection } from '../../src/sdk/system-prompt.js';

describe('DefaultSystemPromptAssembler', () => {
  it('joins template and non-empty sections with double newline', async () => {
    const selector: AgentPromptTemplateSelector = {
      select: () => ({ name: 'test', render: async () => 'Identity' }),
    };
    const sections: PromptSection[] = [
      { name: 'a', render: async () => 'Section A' },
      { name: 'b', render: async () => undefined },
      { name: 'c', render: async () => 'Section C' },
    ];
    const assembler = new DefaultSystemPromptAssembler(selector, sections);
    const result = await assembler.assemble({} as PromptBuildContext);
    expect(result).toBe('Identity\n\nSection A\n\nSection C');
  });
});
