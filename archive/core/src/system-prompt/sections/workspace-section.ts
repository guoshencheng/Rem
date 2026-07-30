import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class WorkspaceSection implements PromptSection {
  readonly name = 'workspace';

  render(ctx: PromptBuildContext): string | undefined {
    if (!ctx.workspaceRoot) return undefined;
    return [
      '## Workspace',
      '',
      `Working directory: ${ctx.workspaceRoot}`,
      `Read-only mode: ${ctx.readOnly}`,
    ].join('\n');
  }
}
