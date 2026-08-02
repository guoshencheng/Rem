import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolProvider, ToolContext, ToolCall, ToolResult } from '../sdk/tool-provider.js';
import { classifyTool } from '../security/permissions/tool-classifier.js';
import { composeToolProviders } from '../tools/composer.js';
import { ToolOverlay, ToolOverlayEntry } from '../tools/overlay.js';
import { SkillProvider } from '../index.js';

export interface AgentToolsParams {
  workspaceRoot: string;
  agentName?: string;
  sessionId: string;

  toolProvider: ToolProvider;
  skillProvider: SkillProvider;
  includeSkillReadTool?: boolean;
  delegateToolProviderEntry?: ToolOverlayEntry;
  todoToolProviderEntry?: ToolOverlayEntry;
  orchestrationToolProviderEntries?: ToolOverlayEntry[];
}

export interface AgentTools {
  tools: AgentTool[];
}

export function createAgentTools(params: AgentToolsParams): AgentTools {
  const { sessionId,
    toolProvider,
    skillProvider,
    delegateToolProviderEntry, todoToolProviderEntry,
  } = params;

  const effectiveToolProvider = params.includeSkillReadTool === false
    ? toolProvider
    : composeToolProviders({ toolProvider, skillProvider });
  const finalToolProvider: ToolProvider = new ToolOverlay(effectiveToolProvider, [
    ...(delegateToolProviderEntry ? [delegateToolProviderEntry] : []),
    ...(todoToolProviderEntry ? [todoToolProviderEntry] : []),
    ...(params.orchestrationToolProviderEntries ?? []),
  ]);

  const executeOne = async (
    toolCallId: string, toolName: string, input: unknown, signal?: AbortSignal,
  ): Promise<ToolResult> => {
    const def = finalToolProvider.getToolDefinition(toolName);
    if (!def) throw new Error(`unknown tool: ${toolName}`);

    const derivedPatterns = def.derivePatterns ? def.derivePatterns(input as never) : [`tool:${toolName}`];
    const category = classifyTool(toolName, def, derivedPatterns);

    const ctx: ToolContext = {
      cwd: params.workspaceRoot,
      workspaceRoot: params.workspaceRoot,
      agentName: params.agentName,
      sessionId,
      toolCallId,
      signal,
    };

    const call: ToolCall = { toolCallId, toolName, input };
    const [result] = await finalToolProvider.execute([call], ctx);
    return result;
  };

  const tools: AgentTool[] = finalToolProvider.getToolSet().map((piTool) => ({
    name: piTool.name,
    description: piTool.description,
    parameters: piTool.parameters,
    label: piTool.name,
    execute: async (toolCallId, input, signal) => {
      const result = await executeOne(toolCallId, piTool.name, input, signal);
      if (result.error) throw new Error(result.error);
      return {
        content: [{ type: 'text' as const, text: result.output ?? '' }],
        details: result.details,
      };
    },
  }));

  return { tools };
}
