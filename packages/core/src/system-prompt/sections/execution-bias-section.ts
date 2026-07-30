import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class ExecutionBiasSection implements PromptSection {
  readonly name = 'execution-bias';

  render(_ctx: PromptBuildContext): string {
    return [
      '## Execution Bias',
      '',
      '- Actionable request: act in this turn.',
      '- Continue until done or genuinely blocked; do not finish with a plan when tools can move forward.',
      '- Weak/empty tool result: vary query, path, command, or source before concluding.',
      '- Mutable facts need live checks: files, git, clocks, versions, services.',
      '- Final answer needs evidence: test/build/lint output, inspection, or a named blocker.',
    ].join('\n');
  }
}
