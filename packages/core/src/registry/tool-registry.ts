import { TypeCompiler } from '@sinclair/typebox/compiler';
import type { TObject } from '@sinclair/typebox';
import type { ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolCall, ToolResult } from '../sdk/tool-provider.js';
import type { ToolPolicyConfig } from '../sdk/tool-policy.js';
import type { ToolHook } from '../sdk/tool-hook.js';
import type { ToolSchema, ToolSet } from '../llm/types.js';
import type { ApprovalOrchestrator, ApprovalChunkEmitter } from '../security/approval-orchestrator.js';
import { applyToolPolicyPipeline } from '../security/tool-policy-pipeline.js';
import { ApprovalManager } from '../security/approval-manager.js';
import { ToolHookRunner } from '../security/tool-hook-runner.js';
import { createDangerousToolHook } from '../security/tool-hooks/dangerous-tool-hook.js';

export interface AgentToolRegistryOptions {
  workspaceRoot: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  policy?: ToolPolicyConfig;
  hooks?: ToolHook[];
  approvalOrchestrator?: ApprovalOrchestrator;
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
  private policy: ToolPolicyConfig;
  private approvalManager = new ApprovalManager();
  private approvalOrchestrator?: ApprovalOrchestrator;
  private hookRunner: ToolHookRunner;

  constructor(options: AgentToolRegistryOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.readOnly = options.readOnly ?? false;
    this.policy = options.policy ?? {};
    this.approvalOrchestrator = options.approvalOrchestrator;

    const hooks: ToolHook[] = [];
    if (!options.autoApproveDangerous) {
      hooks.push(createDangerousToolHook(this.tools));
    }
    hooks.push(...(options.hooks ?? []));

    this.hookRunner = new ToolHookRunner({
      hooks,
      approvalOrchestrator: this.approvalOrchestrator,
    });
  }

  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
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

  async execute(calls: ToolCall[], ctx: ToolContext, emit?: ApprovalChunkEmitter): Promise<ToolResult[]> {
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

      const hookOutcome = await this.hookRunner.run(
        {
          ...ctx,
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          input: call.input,
        },
        emit,
      );

      if (hookOutcome.blocked) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: hookOutcome.blocked.reason,
          details: { audit: { approved: false } },
        });
        continue;
      }

      try {
        const executeParams = (hookOutcome.params ?? call.input) as never;
        const { output, details } = await registered.executor(executeParams, ctx);
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
