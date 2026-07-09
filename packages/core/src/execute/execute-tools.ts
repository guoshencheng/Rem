import type { ModelMessage, ProviderChunk } from '../types.js';
import type { ToolCall, ToolProvider, ToolResult } from '../sdk/tool-provider.js';
import type { Rule } from '../security/rules/rule.js';
import { AgentState } from '../agent-state.js';
import { RuleEngine } from '../security/rules/rule-engine.js';
import { RuleStore } from '../security/rules/rule-store.js';
import { log } from '../shared/debug-log.js';

export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
  agentState: AgentState;
  ruleEngine: RuleEngine;
  ruleStore: RuleStore;
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
  log('tools', 'emitting tool result', { toolCallId: tc.toolCallId, toolName: tc.toolName, outputLength: output.length, hasError: !!result.error });
  emit({ type: 'tool-result', step: 0, toolCallId: tc.toolCallId, output, error: result.error } as ProviderChunk);
  const msg = addMessage('tool');
  appendContent(msg, { type: 'tool-result', toolCallId: tc.toolCallId, toolName: tc.toolName, output });
}

function formatDescription(tc: ToolCall): string {
  return JSON.stringify(tc.input).slice(0, 200);
}

function derivePatterns(tc: ToolCall, toolProvider: ToolProvider): string[] {
  const def = toolProvider.getToolDefinition(tc.toolName);
  if (def?.derivePatterns) {
    return def.derivePatterns(tc.input as never);
  }
  return [`tool:${tc.toolName}`];
}

function deriveAlwaysOptions(tc: ToolCall, toolProvider: ToolProvider): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const def = toolProvider.getToolDefinition(tc.toolName);
  if (def?.deriveAlwaysOptions) {
    return def.deriveAlwaysOptions(tc.input as never);
  }
  return [
    { label: tc.toolName, rule: { permission: tc.toolName, pattern: '*', action: 'allow' } },
  ];
}

export async function executeTools(params: ExecuteParams): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const { toolProvider, agentState, ruleEngine, ruleStore, addMessage, appendContent, emit, signal } = params;

  for (const tc of params.toolCalls) {
    log('tools', 'executing tool call', { sessionId: params.sessionId, toolCallId: tc.toolCallId, toolName: tc.toolName });

    const derivedPatterns = derivePatterns(tc, toolProvider);
    const action = ruleEngine.evaluate({ toolName: tc.toolName, input: tc.input, derivedPatterns });

    if (action === 'deny') {
      const denied: ToolResult = { toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: 'denied by rule' };
      emitToolResult(tc, denied, emit, addMessage, appendContent);
      results.push(denied);
      continue;
    }

    if (action === 'ask') {
      const alwaysOptions = deriveAlwaysOptions(tc, toolProvider);
      const liveState = agentState.getOrCreate(params.sessionId);
      const request = liveState.approvalEngine.createRequest({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        patterns: derivedPatterns,
        title: `Run ${tc.toolName}`,
        description: formatDescription(tc),
        severity: 'warning',
        alwaysOptions,
      });

      liveState.pendingApprovals.push(request);
      emit({ type: 'approval-request', sessionId: params.sessionId, request } as ProviderChunk);
      log('tools', 'approval requested', { sessionId: params.sessionId, toolCallId: tc.toolCallId, approvalId: request.approvalId });

      const resolution = await liveState.approvalEngine.wait(request.approvalId);

      liveState.pendingApprovals = liveState.pendingApprovals.filter((r) => r.approvalId !== request.approvalId);
      emit({ type: 'approval-resolved', sessionId: params.sessionId, approvalId: request.approvalId, decision: resolution.decision } as ProviderChunk);
      log('tools', 'approval resolved', { sessionId: params.sessionId, toolCallId: tc.toolCallId, approvalId: request.approvalId, decision: resolution.decision });

      if (resolution.decision === 'deny') {
        const denied: ToolResult = { toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: 'denied' };
        emitToolResult(tc, denied, emit, addMessage, appendContent);
        results.push(denied);
        continue;
      }

      if (resolution.decision === 'allow-always' && resolution.rule) {
        await ruleStore.saveApproved(resolution.rule);
        ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
      }
    }

    log('tools', 'calling tool provider', { sessionId: params.sessionId, toolCallId: tc.toolCallId, toolName: tc.toolName });
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
