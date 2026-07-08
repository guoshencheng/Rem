import type { ModelMessage, ProviderChunk } from '../types.js';
import type { ToolCall, ToolProvider, ToolResult } from '../sdk/tool-provider.js';
import type { ApprovalRequest } from '../sdk/agent-state-provider.js';
import { AgentState } from '../agent-state.js';

const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;

export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
  agentState: AgentState;
  addMessage: (role: 'tool') => ModelMessage;
  appendContent: (msg: ModelMessage, part: { type: string; [key: string]: unknown }) => void;
  workspaceRoot: string;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
  signal?: AbortSignal;
  emit: (chunk: ProviderChunk) => void;
}

/** emit 工具结果 + 写入 conversation */
function emitToolResult(
  tc: ToolCall, result: ToolResult,
  emit: (chunk: ProviderChunk) => void,
  addMessage: (role: 'tool') => ModelMessage,
  appendContent: (msg: ModelMessage, part: { type: string; [key: string]: unknown }) => void,
): void {
  const output = result.error ?? result.output ?? '';
  emit({ type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output, error: result.error } as ProviderChunk);
  const msg = addMessage('tool');
  appendContent(msg, { type: 'tool-result', toolCallId: tc.toolCallId, toolName: tc.toolName, output });
}

export async function executeTools(params: ExecuteParams): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const { toolProvider, agentState, addMessage, appendContent, emit, signal } = params;

  for (const tc of params.toolCalls) {
    const dangerous = toolProvider.isDangerous(tc.toolName);

    if (dangerous) {
      const approvalId = generateId();
      const request: ApprovalRequest = {
        approvalId, toolName: tc.toolName, toolCallId: tc.toolCallId,
        title: `Run ${tc.toolName}`,
        allowedDecisions: ['allow-once', 'deny'],
        sessionId: params.sessionId,
      };

      const liveState = agentState.getOrCreate(params.sessionId);
      liveState.pendingApprovals.push(request);

      emit({ type: 'approval-request', sessionId: params.sessionId, request } as ProviderChunk);

      const decision = await agentState.waitApproval(params.sessionId, approvalId, DEFAULT_APPROVAL_TIMEOUT_MS);

      const resolved = agentState.getOrCreate(params.sessionId);
      resolved.pendingApprovals = resolved.pendingApprovals.filter(r => r.approvalId !== approvalId);

      emit({ type: 'approval-resolved', sessionId: params.sessionId, approvalId, decision } as ProviderChunk);

      if (decision !== 'allow-once') {
        const errMsg = decision === null ? 'approval timed out' : 'denied';
        const denied: ToolResult = { toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: errMsg };
        emitToolResult(tc, denied, emit, addMessage, appendContent);
        results.push(denied);
        continue;
      }
    }

    const [result] = await toolProvider.execute([tc], {
      cwd: params.workspaceRoot, workspaceRoot: params.workspaceRoot,
      signal, agentName: params.agentName, readOnly: params.readOnly,
      sessionId: params.sessionId,
    });
    results.push(result);
    emitToolResult(tc, result, emit, addMessage, appendContent);
  }

  return results;
}

function generateId(): string {
  return crypto.randomUUID();
}
