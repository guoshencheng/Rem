import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolProvider } from '../../sdk/tool-provider.js';

export function createRuntimeAgentTools(
  provider: ToolProvider,
  sessionId: string,
  executionRoot: string,
  agentName?: string,
  readOnly?: boolean,
): AgentTool[] {
  return provider.getToolSet().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    label: tool.name,
    execute: async (toolCallId, input, signal) => {
      const [result] = await provider.execute([{
        toolCallId, toolName: tool.name, input,
      }], {
        cwd: executionRoot,
        executionRoot,
        sessionId,
        agentName,
        readOnly,
        toolCallId,
        signal,
      });
      if (result.error) throw new Error(result.error);
      return {
        content: [{ type: 'text' as const, text: result.output }],
        details: result.details,
      };
    },
  }));
}
