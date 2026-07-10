import type { ModelMessage, ProviderChunk } from '../types.js';
import type { ToolCall, ToolProvider, ToolResult, ToolContext } from '../sdk/tool-provider.js';
import type { ToolPermissionEvaluator } from '../security/permissions/types.js';
import type { SecurityMode } from '../security/permissions/factory.js';
import type { Rule } from '../security/rules/rule.js';
import type { RuleStorage } from '../storage/types.js';
import { AgentState } from '../agent-state.js';
import { RuleEngine } from '../security/rules/rule-engine.js';
import { WorkspaceOutsideError } from '../security/workspace-root-guard.js';
import { classifyTool } from '../security/permissions/tool-classifier.js';
import type { ToolCategory } from '../security/permissions/tool-classifier.js';
import { log } from '../shared/debug-log.js';

export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
  permissionEvaluator: ToolPermissionEvaluator;
  agentState: AgentState;
  ruleEngine: RuleEngine;
  ruleStore: RuleStorage;
  securityMode: SecurityMode;
  addMessage: (role: 'tool') => ModelMessage;
  appendContent: (msg: ModelMessage, part: { type: string; [key: string]: unknown }) => void;
  workspaceRoot: string;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
  signal?: AbortSignal;
  emit: (chunk: ProviderChunk) => void;
}

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

export async function executeTools(params: ExecuteParams): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const { toolProvider, permissionEvaluator, agentState, ruleEngine, ruleStore, addMessage, appendContent, emit, signal } = params;

  for (const tc of params.toolCalls) {
    log('tools', 'executing tool call', { sessionId: params.sessionId, toolCallId: tc.toolCallId, toolName: tc.toolName });

    const def = toolProvider.getToolDefinition(tc.toolName);
    if (!def) {
      const denied: ToolResult = { toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: `unknown tool: ${tc.toolName}` };
      emitToolResult(tc, denied, emit, addMessage, appendContent);
      results.push(denied);
      continue;
    }

    const decision = await permissionEvaluator.evaluate(tc, def);

    if (decision.action === 'deny') {
      const denied: ToolResult = { toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: decision.reason };
      emitToolResult(tc, denied, emit, addMessage, appendContent);
      results.push(denied);
      continue;
    }

    if (decision.action === 'ask') {
      const liveState = agentState.getOrCreate(params.sessionId);
      const request = liveState.approvalEngine.createRequest(decision.request);

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

    const derivedPatterns = def.derivePatterns
      ? def.derivePatterns(tc.input as never)
      : [`tool:${tc.toolName}`];
    const category = classifyTool(tc.toolName, def, derivedPatterns);
    const outsideAllowed = computeOutsideAllowed(
      params.securityMode,
      category,
      ruleEngine,
      tc.toolName,
      derivedPatterns,
    );

    log('tools', 'calling tool provider', { sessionId: params.sessionId, toolCallId: tc.toolCallId, toolName: tc.toolName });
    const ctx = {
      cwd: params.workspaceRoot, workspaceRoot: params.workspaceRoot,
      signal, agentName: params.agentName, readOnly: params.readOnly,
      sessionId: params.sessionId, outsideAllowed,
    };

    let result: ToolResult;
    try {
      [result] = await toolProvider.execute([tc], ctx);
    } catch (err) {
      if (err instanceof WorkspaceOutsideError) {
        result = await handleOutsideWorkspaceError(tc, err, params, ctx, category);
      } else {
        result = {
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    results.push(result);
    emitToolResult(tc, result, emit, addMessage, appendContent);
  }

  return results;
}

function computeOutsideAllowed(
  mode: SecurityMode,
  category: ToolCategory,
  ruleEngine: RuleEngine,
  toolName: string,
  derivedPatterns: string[],
): boolean {
  if (ruleEngine.checkOutsideAllowed(toolName, derivedPatterns)) {
    return true;
  }
  if (mode === 'auto' && category === 'read') {
    return true;
  }
  return false;
}

async function handleOutsideWorkspaceError(
  tc: ToolCall,
  err: WorkspaceOutsideError,
  params: ExecuteParams,
  ctx: ToolContext,
  category: ToolCategory,
): Promise<ToolResult> {
  if (params.securityMode === 'auto' && category === 'write') {
    const allowedCtx = { ...ctx, outsideAllowed: true };
    const [result] = await params.toolProvider.execute([tc], allowedCtx);
    return result;
  }

  if (params.securityMode === 'auto') {
    return {
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: '',
      error: `Path outside workspace denied in auto mode: ${err.absolutePath}`,
    };
  }

  const liveState = params.agentState.getOrCreate(params.sessionId);
  const request = liveState.approvalEngine.createRequest({
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    patterns: [err.absolutePath],
    title: `Access outside workspace: ${tc.toolName}`,
    description: `Path "${err.absolutePath}" resolves outside workspace root "${err.workspaceRoot}"`,
    severity: 'warning',
    alwaysOptions: [
      {
        label: err.absolutePath,
        rule: {
          permission: tc.toolName,
          pattern: err.absolutePath,
          action: 'allow',
          outside: true,
        },
      },
      {
        label: `allow all outside ${tc.toolName}`,
        rule: {
          permission: tc.toolName,
          pattern: '**',
          action: 'allow',
          outside: true,
        },
      },
    ],
  });

  liveState.pendingApprovals.push(request);
  params.emit({ type: 'approval-request', sessionId: params.sessionId, request } as ProviderChunk);
  log('tools', 'approval requested', { sessionId: params.sessionId, toolCallId: tc.toolCallId, approvalId: request.approvalId });

  const resolution = await liveState.approvalEngine.wait(request.approvalId);
  liveState.pendingApprovals = liveState.pendingApprovals.filter(
    (r) => r.approvalId !== request.approvalId,
  );
  params.emit({
    type: 'approval-resolved',
    sessionId: params.sessionId,
    approvalId: request.approvalId,
    decision: resolution.decision,
  } as ProviderChunk);
  log('tools', 'approval resolved', { sessionId: params.sessionId, toolCallId: tc.toolCallId, approvalId: request.approvalId, decision: resolution.decision });

  if (resolution.decision === 'deny') {
    return {
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: '',
      error: 'denied',
    };
  }

  if (resolution.decision === 'allow-always' && resolution.rule) {
    await params.ruleStore.saveApproved(resolution.rule);
    params.ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
  }

  const allowedCtx = { ...ctx, outsideAllowed: true };
  const [result] = await params.toolProvider.execute([tc], allowedCtx);
  return result;
}
