import { ToolOverlay, defineOverlayTool } from './overlay.js';
import { createReadSkillTool } from '../plugins/tool/builtin/skill-read.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';

export function composeToolProviders({ toolProvider, skillProvider }: {
  toolProvider: ToolProvider;
  skillProvider: SkillProvider;
}): ToolProvider {
  const readSkillTool = createReadSkillTool(skillProvider);
  return new ToolOverlay(toolProvider, [
    defineOverlayTool(readSkillTool.definition, readSkillTool.executor),
  ]);
}
