import type { Session } from '../session.js';
import type { ProviderChunk } from '../types.js';
import type { ToolCall, ToolProvider, ToolResult } from '../sdk/tool-provider.js';
import type { AgentLiveProvider, ApprovalRequest } from '../sdk/agent-state-provider.js';
import { generateId } from '../shared/generate-id.js';
import { ApprovalRegistry } from './approval-registry.js';

const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;

export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
  liveProvider?: AgentLiveProvider;
  registry?: ApprovalRegistry;
  session: Session;
  workspaceRoot: string;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
  signal?: AbortSignal;
  emit: (chunk: ProviderChunk) => void;
}

/** emit 工具结果 + 同步写入 conversation */
function emitToolResult(
  tc: ToolCall, result: ToolResult, session: Session,
  emit: (chunk: ProviderChunk) => void,
): void {
  const output = result.error ?? result.output ?? '';
  emit({ type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output, error: result.error } as ProviderChunk);
  session.conversation.push({
    id: generateId(), role: 'tool',
    content: [{ type: 'tool-result', toolCallId: tc.toolCallId, toolName: tc.toolName, output }],
  });
}

export async function executeTools(params: ExecuteParams): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const { toolProvider, liveProvider, registry, session, emit, signal } = params;

  for (const tc of params.toolCalls) {
    const dangerous = toolProvider.isDangerous(tc.toolName);

    if (dangerous && registry && liveProvider) {
      const approvalId = generateId();
      const request: ApprovalRequest = {
        approvalId, toolName: tc.toolName, toolCallId: tc.toolCallId,
        title: `Run ${tc.toolName}`,
        allowedDecisions: ['allow-once', 'deny'],
        sessionId: params.sessionId,
      };

      const liveState = await liveProvider.getOrCreate(params.sessionId);
      liveState.pendingApprovals.push(request);
      await liveProvider.set(params.sessionId, liveState);

      emit({ type: 'approval-request', sessionId: params.sessionId, request } as ProviderChunk);

      const decision = await registry.wait(approvalId, DEFAULT_APPROVAL_TIMEOUT_MS);

      const resolved = await liveProvider.getOrCreate(params.sessionId);
      resolved.pendingApprovals = resolved.pendingApprovals.filter(r => r.approvalId !== approvalId);
      await liveProvider.set(params.sessionId, resolved);

      emit({ type: 'approval-resolved', sessionId: params.sessionId, approvalId, decision } as ProviderChunk);

      if (decision !== 'allow-once') {
        const errMsg = decision === null ? 'approval timed out' : 'denied';
        emit({ type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output: '', error: errMsg } as ProviderChunk);
        results.push({ toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: errMsg });
        continue;
      }
    }

    const [result] = await toolProvider.execute([tc], {
      cwd: params.workspaceRoot, workspaceRoot: params.workspaceRoot,
      signal, agentName: params.agentName, readOnly: params.readOnly,
      sessionId: params.sessionId,
    });
    results.push(result);
    emitToolResult(tc, result, session, emit);
  }

  return results;
}
