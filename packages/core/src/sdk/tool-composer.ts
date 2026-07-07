import type { ToolProvider } from './tool-provider.js';
import type { SkillProvider } from './skill-provider.js';

export interface ToolComposer {
  compose(params: {
    toolProvider: ToolProvider;
    mcpProviders: ToolProvider[];
    skillProvider: SkillProvider;
  }): ToolProvider;
}
