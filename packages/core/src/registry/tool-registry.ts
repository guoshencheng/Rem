import { TypeCompiler } from '@sinclair/typebox/compiler';
import type { TObject } from '@sinclair/typebox';
import type { ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolCall, ToolResult } from '../sdk/tool-provider.js';
import type { ToolPolicyLike } from '../sdk/tool-policy.js';
import type { ToolSchema, ToolSet } from '../llm/types.js';
import { applyToolPolicyPipeline, normalizeToolName } from '../security/tool-policy-pipeline.js';
import type { ApprovalHook } from '../security/approval-hook.js';
import { defaultApprovalHook } from '../security/approval-hook.js';

export interface AgentToolRegistryOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  policy?: ToolPolicyLike;
  approvalHook?: ApprovalHook;
}

export class AgentToolRegistry implements ToolProvider {
  private tools = new Map<
    string,
    {
      def: ToolDefinition;
      executor: ToolExecutor;
      check: ReturnType<typeof TypeCompiler.Compile>;
    }
  >();
  private workspaceRoot: string;
  private readOnly: boolean;
  private policy: ToolPolicyLike;
  private approvalHook: ApprovalHook;

  constructor(options: AgentToolRegistryOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.readOnly = options.readOnly ?? false;
    this.policy = options.policy ?? {};
    this.approvalHook = options.approvalHook ?? defaultApprovalHook;
  }

  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
    this.tools.set(def.name, {
      def: def as ToolDefinition,
      executor: executor as ToolExecutor,
      check: TypeCompiler.Compile(def.parameters),
    });
  }

  getToolSet(): ToolSet {
    const all = Array.from(this.tools.values()).map((entry) => entry.def);
    const filtered = applyToolPolicyPipeline({
      tools: all,
      readOnly: this.readOnly,
      policy: this.policy,
    });
    const result: ToolSet = {};
    for (const def of filtered) {
      const schema: ToolSchema = {
        description: def.description,
        parameters: def.parameters as Record<string, unknown>,
      };
      result[def.name] = schema;
    }
    return result;
  }

  async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      const registered = this.tools.get(call.toolName);
      if (!registered) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: `Tool "${call.toolName}" not found`,
        });
        continue;
      }

      if (!registered.check.Check(call.input)) {
        const errors = Array.from(registered.check.Errors(call.input));
        const message = errors.map((e) => `${e.path}: ${e.message}`).join('; ') || 'invalid input';
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: `Invalid input for tool "${call.toolName}": ${message}`,
        });
        continue;
      }

      if (registered.def.dangerous) {
        const approval = await this.approvalHook(call.toolName, call.input, ctx);
        if (!approval.approved) {
          results.push({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: '',
            error: approval.reason || `Tool "${call.toolName}" was not approved`,
            details: { audit: { approved: false } },
          });
          continue;
        }
      }

      try {
        const { output, details } = await registered.executor(call.input as never, ctx);
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output,
          details,
        });
      } catch (err) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }
}
