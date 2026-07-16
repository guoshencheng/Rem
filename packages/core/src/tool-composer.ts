import { CompositeToolProvider } from './mcp/composite-tool-provider.js';
import { OverlayToolProvider } from './overlay-tool-provider.js';
import { createReadSkillTool } from './plugins/tool/builtin/skill-read.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ToolComposer } from './sdk/tool-composer.js';

export class DefaultToolComposer implements ToolComposer {
  compose({ toolProvider, mcpProviders, skillProvider }: {
    toolProvider: ToolProvider;
    mcpProviders: ToolProvider[];
    skillProvider: SkillProvider;
  }): ToolProvider {
    const base = mcpProviders.length > 0
      ? new CompositeToolProvider(toolProvider, mcpProviders)
      : toolProvider;

    const overlay = new OverlayToolProvider(base);
    const readSkillTool = createReadSkillTool(skillProvider);
    overlay.register(readSkillTool.definition, readSkillTool.executor);

    return overlay;
  }
}
