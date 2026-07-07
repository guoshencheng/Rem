import type { Session } from '../session.js';
import type { ProviderChunk } from '../types.js';
import type { ToolCall, ToolProvider, ToolResult } from '../sdk/tool-provider.js';
import type { AgentLiveProvider, ApprovalRequest, ApprovalDecision } from '../sdk/agent-state-provider.js';
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

export async function executeTools(params: ExecuteParams): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const { toolProvider, liveProvider, registry, session, emit, signal } = params;

  for (const tc of params.toolCalls) {
    const dangerous = toolProvider.isDangerous(tc.toolName);

    if (dangerous && registry && liveProvider) {
      const approvalId = generateId();
      const request: ApprovalRequest = {
        approvalId,
        toolName: tc.toolName,
        toolCallId: tc.toolCallId,
        title: `Run ${tc.toolName}`,
        allowedDecisions: ['allow-once', 'deny'],
        sessionId: params.sessionId,
      };

      // 持久化待审批状态
      let liveState = await liveProvider.get(params.sessionId);
      if (!liveState) liveState = new (await import('../state.js')).AgentLiveState();
      liveState.pendingApprovals.push(request);
      await liveProvider.set(params.sessionId, liveState);

      // 通知前端
      emit({ type: 'approval-request', sessionId: params.sessionId, request } as any);

      // 等待审批决定
      const decision = await registry.wait(approvalId, DEFAULT_APPROVAL_TIMEOUT_MS);

      // 清理持久化状态
      liveState = await liveProvider.get(params.sessionId);
      if (liveState) {
        liveState.pendingApprovals = liveState.pendingApprovals.filter(r => r.approvalId !== approvalId);
        await liveProvider.set(params.sessionId, liveState);
      }

      // 通知前端审批结果
      emit({ type: 'approval-resolved', sessionId: params.sessionId, approvalId, decision } as any);

      if (decision !== 'allow-once') {
        const errMsg = decision === null ? 'approval timed out' : 'denied';
        emit({ type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output: '', error: errMsg } as any);
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

    const output = result.error ?? result.output ?? '';
    emit({ type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output, error: result.error } as any);

    session.conversation.push({
      id: generateId(), role: 'tool',
      content: [{ type: 'tool-result', toolCallId: tc.toolCallId, toolName: tc.toolName, output }],
    });
  }

  return results;
}
