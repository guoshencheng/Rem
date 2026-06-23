import type { ToolDefinition } from '../../sdk/tool-provider.js';
import type { ToolHook, ToolHookContext, ToolHookResult } from '../../sdk/tool-hook.js';

export function createDangerousToolHook(
  tools: Map<string, { def: ToolDefinition }>,
): ToolHook {
  return (ctx: ToolHookContext): ToolHookResult | undefined => {
    const def = tools.get(ctx.toolName)?.def;
    if (!def?.dangerous) return undefined;
    return {
      requireApproval: {
        title: `Run ${ctx.toolName}`,
        description: `Tool "${ctx.toolName}" is marked dangerous and requires approval.`,
        severity: 'warning',
        allowedDecisions: ['allow-once', 'allow-always', 'deny'],
      },
    };
  };
}
