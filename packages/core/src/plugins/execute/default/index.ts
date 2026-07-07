import type { AgentStreamChunk } from '../../../types.js';
import type {
  ExecuteContext,
  ExecuteProvider,
} from '../../../sdk/execute-provider.js';
import type { ToolCall, ToolProvider, ToolResult } from '../../../sdk/tool-provider.js';

export interface DefaultExecuteProviderOptions {
  toolProvider: ToolProvider;
}

export class DefaultExecuteProvider implements ExecuteProvider {
  constructor(private options: DefaultExecuteProviderOptions) {}

  async execute(
    toolCalls: ToolCall[],
    ctx: ExecuteContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    const toolCtx = {
      cwd: ctx.cwd,
      workspaceRoot: ctx.workspaceRoot,
      signal: ctx.signal,
      agentName: ctx.agentName,
      readOnly: ctx.readOnly,
      sessionId: ctx.sessionId,
    };

    const results = await this.options.toolProvider.execute(toolCalls, toolCtx, {
      emit: async (chunk) => {
        await emit(chunk);
      },
    });

    for (const tc of toolCalls) {
      const tr = results.find((r) => r.toolCallId === tc.toolCallId);
      const output = tr?.error ?? tr?.output ?? '';
      await emit({
        type: 'tool-result',
        step: 0,
        toolCallId: tc.toolCallId,
        output,
        error: tr?.error,
      });
    }

    return results;
  }
}

export function createProvider(options: DefaultExecuteProviderOptions): DefaultExecuteProvider {
  return new DefaultExecuteProvider(options);
}
