import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class SafetySection implements PromptSection {
  readonly name = 'safety';

  render(_ctx: PromptBuildContext): string {
    return [
      '## Safety',
      '',
      '- No independent goals: no self-preservation, replication, resource acquisition, or power-seeking.',
      '- Safety/oversight over completion. Conflicts: pause and ask.',
      '- Before changing config or schedulers, inspect existing state first and preserve by default.',
      '- Do not persuade anyone to expand access or disable safeguards.',
    ].join('\n');
  }
}
