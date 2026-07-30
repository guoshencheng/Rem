import type { AgentTool, BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { AgentStreamEvent } from '../agent/types.js';
import type { BusEvent } from '../agent/bus-events.js';
import type { AgentDI } from '../assembly/agent-di.js';
import type { ToolProvider, ToolContext, ToolCall, ToolResult } from '../sdk/tool-provider.js';
import type { SecurityMode } from '../security/permissions/factory.js';
import type { ApprovalStateHost } from '../security/approval/request-approval.js';
import type { REMAgent } from '../agent/rem-agent.js';
import { WorkspaceOutsideError } from '../security/workspace/workspace-outside-error.js';
import { classifyTool } from '../security/permissions/tool-classifier.js';
import { requestApproval } from '../security/approval/request-approval.js';
import { composeToolProviders } from '../tools/composer.js';
import { ToolOverlay, defineOverlayTool } from '../tools/overlay.js';
import { DefaultTodoService } from '../capabilities/todo/service.js';
import { createTodoWriteToolDefinition, createTodoWriteToolExecutor } from '../plugins/tool/builtin/todo-write.js';
import { createDelegateTaskExecutor, createDelegateTaskToolDefinition, type SpawnChild } from '../capabilities/sub-agent/delegate-task.js';

export interface PiAgentToolsParams {
  di: AgentDI;
  agentState: ApprovalStateHost;
  securityMode: SecurityMode;
  workspaceRoot: string;
  /** todo_write 执行器的工作目录 */
  workspace: string;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
  signal?: AbortSignal;
  emit: (event: AgentStreamEvent) => void;
  /** BusEvent 出口（todo_write 等工具直发总线） */
  publishBus: (event: BusEvent) => void;
  /** delegate_task 挂树的父 Agent */
  parent: REMAgent;
  /** delegate_task 能力；缺省时 delegate_task 调用直接抛错 */
  spawnChild?: SpawnChild;
}

export interface PiAgentTools {
  tools: AgentTool[];
  beforeToolCall: (context: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined>;
}

export function createPiAgentTools(params: PiAgentToolsParams): PiAgentTools {
  const { di, agentState, sessionId, emit } = params;
  const { permissionEvaluator, ruleEngine, storage } = di;

  const effectiveToolProvider = composeToolProviders({
    toolProvider: di.toolProvider,
    mcpProviders: di.mcpProviders,
    skillProvider: di.skillProvider,
  });

  const spawnChild: SpawnChild =
    params.spawnChild ??
    (async () => {
      throw new Error('delegate_task is not available for this agent');
    });

  const toolProvider: ToolProvider = new ToolOverlay(effectiveToolProvider, [
    defineOverlayTool(
      createDelegateTaskToolDefinition(),
      createDelegateTaskExecutor({
        parentAgent: () => params.parent,
        spawnChild,
      }),
    ),
    defineOverlayTool(
      createTodoWriteToolDefinition(),
      createTodoWriteToolExecutor(
        new DefaultTodoService(di.storage.todoStore),
        (event) => params.publishBus(event),
        params.workspace,
      ),
    ),
  ]);

  const beforeToolCall = async (context: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    const toolName = context.toolCall.name;
    const def = toolProvider.getToolDefinition(toolName);
    if (!def) return { block: true, reason: `unknown tool: ${toolName}` };

    const call: ToolCall = { toolCallId: context.toolCall.id, toolName, input: context.args };
    const decision = await permissionEvaluator.evaluate(call, def);

    if (decision.action === 'deny') return { block: true, reason: decision.reason };

    if (decision.action === 'ask') {
      const resolution = await requestApproval({ agentState, sessionId, input: decision.request, emit });
      if (resolution.decision === 'deny') return { block: true, reason: 'denied' };
      if (resolution.decision === 'allow-always' && resolution.rule) {
        await storage.ruleStore.saveApproved(resolution.rule);
        ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
      }
    }
    return undefined;
  };

  const executeOne = async (toolCallId: string, toolName: string, input: unknown): Promise<ToolResult> => {
    const def = toolProvider.getToolDefinition(toolName);
    if (!def) throw new Error(`unknown tool: ${toolName}`);

    const derivedPatterns = def.derivePatterns ? def.derivePatterns(input as never) : [`tool:${toolName}`];
    const category = classifyTool(toolName, def, derivedPatterns);
    const outsideAllowed =
      ruleEngine.checkOutsideAllowed(toolName, derivedPatterns) ||
      (params.securityMode === 'auto' && category === 'read');

    const ctx: ToolContext = {
      cwd: params.workspaceRoot, workspaceRoot: params.workspaceRoot,
      signal: params.signal, agentName: params.agentName, readOnly: params.readOnly,
      sessionId, toolCallId, outsideAllowed,
    };

    const call: ToolCall = { toolCallId, toolName, input };
    try {
      const [result] = await toolProvider.execute([call], ctx);
      return result;
    } catch (err) {
      if (err instanceof WorkspaceOutsideError) {
        return handleOutsideWorkspace(call, err, params, toolProvider, ctx, category);
      }
      throw err;
    }
  };

  const tools: AgentTool[] = toolProvider.getToolSet().map((piTool) => ({
    name: piTool.name,
    description: piTool.description,
    parameters: piTool.parameters,
    label: piTool.name,
    execute: async (toolCallId, input) => {
      const result = await executeOne(toolCallId, piTool.name, input);
      if (result.error) throw new Error(result.error);
      return {
        content: [{ type: 'text' as const, text: result.output ?? '' }],
        details: result.details,
      };
    },
  }));

  return { tools, beforeToolCall };
}

async function handleOutsideWorkspace(
  call: ToolCall,
  err: WorkspaceOutsideError,
  params: PiAgentToolsParams,
  toolProvider: ToolProvider,
  ctx: ToolContext,
  category: ReturnType<typeof classifyTool>,
): Promise<ToolResult> {
  const { ruleEngine, storage } = params.di;

  if (params.securityMode === 'auto' && category === 'write') {
    const [result] = await toolProvider.execute([call], { ...ctx, outsideAllowed: true });
    return result;
  }
  if (params.securityMode === 'auto') {
    return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `Path outside workspace denied in auto mode: ${err.absolutePath}` };
  }

  const resolution = await requestApproval({
    agentState: params.agentState,
    sessionId: params.sessionId,
    input: {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      patterns: [err.absolutePath],
      title: `Access outside workspace: ${call.toolName}`,
      description: `Path "${err.absolutePath}" resolves outside workspace root "${err.workspaceRoot}"`,
      severity: 'warning',
      alwaysOptions: [
        { label: err.absolutePath, rule: { permission: call.toolName, pattern: err.absolutePath, action: 'allow', outside: true } },
        { label: `allow all outside ${call.toolName}`, rule: { permission: call.toolName, pattern: '**', action: 'allow', outside: true } },
      ],
    },
    emit: params.emit,
  });

  if (resolution.decision === 'deny') {
    return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: 'denied' };
  }
  if (resolution.decision === 'allow-always' && resolution.rule) {
    await storage.ruleStore.saveApproved(resolution.rule);
    ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
  }
  const [result] = await toolProvider.execute([call], { ...ctx, outsideAllowed: true });
  return result;
}
