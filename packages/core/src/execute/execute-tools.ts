import type { Session } from '../session.js';
import type { ProviderChunk } from '../types.js';
import type { ToolCall, ToolProvider, ToolResult } from '../sdk/tool-provider.js';
import type { ApprovalOrchestrator } from '../sdk/approval-orchestrator.js';
import { generateId } from '../shared/generate-id.js';

export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
  approvalOrchestrator?: ApprovalOrchestrator;
  session: Session;
  workspaceRoot: string;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
  signal?: AbortSignal;
  emit: (chunk: ProviderChunk) => void;
}

export async function executeTools(params: ExecuteParams): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const { toolProvider, approvalOrchestrator, session, emit, signal } = params;

  for (const tc of params.toolCalls) {
    const dangerous = toolProvider.isDangerous(tc.toolName);

    // 审批
    if (dangerous && approvalOrchestrator) {
      const decision = await approvalOrchestrator.requestApproval(
        {
          sessionId: params.sessionId,
          toolName: tc.toolName,
          toolCallId: tc.toolCallId,
          cwd: params.workspaceRoot,
          workspaceRoot: params.workspaceRoot,
          signal,
          input: tc.input,
        } as any,
        {
          title: `Run ${tc.toolName}`,
          allowedDecisions: ['allow-once', 'deny'],
        },
        { emit: (chunk) => emit(chunk as ProviderChunk) },
      );

      if (decision !== 'allow-once') {
        const errMsg = 'denied';
        emit({ type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output: '', error: errMsg } as ProviderChunk);
        results.push({ toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: errMsg });
        continue;
      }
    }

    // 执行
    const [result] = await toolProvider.execute([tc], {
      cwd: params.workspaceRoot,
      workspaceRoot: params.workspaceRoot,
      signal,
      agentName: params.agentName,
      readOnly: params.readOnly,
      sessionId: params.sessionId,
    });
    results.push(result);

    // 输出结果 + 写消息
    const output = result.error ?? result.output ?? '';
    emit({ type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output, error: result.error } as ProviderChunk);

    session.conversation.push({
      id: generateId(), role: 'tool',
      content: [{ type: 'tool-result', toolCallId: tc.toolCallId, toolName: tc.toolName, output }],
    });
  }

  return results;
}
