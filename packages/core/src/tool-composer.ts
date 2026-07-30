import { CompositeToolProvider } from './mcp/composite-tool-provider.js';
import { ToolOverlay, defineOverlayTool } from './tool-overlay.js';
import { createReadSkillTool } from './plugins/tool/builtin/skill-read.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';

export function composeToolProviders({ toolProvider, mcpProviders, skillProvider }: {
  toolProvider: ToolProvider;
  mcpProviders: ToolProvider[];
  skillProvider: SkillProvider;
}): ToolProvider {
  const base = mcpProviders.length > 0
    ? new CompositeToolProvider(toolProvider, mcpProviders)
    : toolProvider;

  const readSkillTool = createReadSkillTool(skillProvider);
  return new ToolOverlay(base, [
    defineOverlayTool(readSkillTool.definition, readSkillTool.executor),
  ]);
}
