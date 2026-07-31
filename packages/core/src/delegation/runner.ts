import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { REMAgent, REMAgentParams } from '../agent/rem-agent.js';
import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import type { SessionService } from '../session/service.js';
import type { DelegationContext, DelegationRequest, DelegationResult } from './types.js';
import type { DelegationEventDriver } from './event-driver.js';
import { assertDelegationDepth } from './depth.js';

export interface DelegationRunnerDeps {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  sessionService: SessionService;
  eventDriver: DelegationEventDriver;
  createAgent: (params: REMAgentParams) => REMAgent;
  publish: (event: AgentSystemEvent) => void;
  maxDepth: number;
}

/** 创建、驱动并释放一个 one-shot child Agent。 */
export class DelegationRunner {
  constructor(private readonly deps: DelegationRunnerDeps) {}

  async run(request: DelegationRequest, context: DelegationContext): Promise<DelegationResult> {
    assertDelegationDepth(context.depth, this.deps.maxDepth);
    const child = await this.deps.sessionService.createDelegationSession({
      parentSessionId: context.parentSessionId,
      parentToolCallId: context.parentToolCallId,
      workspace: context.workspace,
      task: request.task,
      depth: context.depth,
    });
    this.publish(context, child.sessionId, request.task, 'running');
    let agent: REMAgent | undefined;
    try {
      agent = this.deps.createAgent({
        di: this.deps.di,
        runtimeConfig: this.deps.runtimeConfig,
        session: child,
        workspace: context.workspace,
        workspaceRoot: context.workspaceRoot,
        agentId: `delegate-${child.sessionId}`,
        sessionId: child.sessionId,
        summary: request.task,
        systemPrompt: request.systemPrompt,
        maxTurns: request.maxTurns,
        signal: context.signal,
        runDelegation: (nested, toolContext) => this.run(nested, {
          parentSessionId: child.sessionId,
          parentToolCallId: toolContext.toolCallId ?? 'unknown',
          workspace: context.workspace,
          workspaceRoot: toolContext.workspaceRoot,
          depth: context.depth + 1,
          signal: toolContext.signal,
        }),
      });
      const events = agent.run({ content: request.task, timestamp: new Date() });
      const usage = await this.deps.eventDriver.drive(child.sessionId, events);
      const output = (await agent.output) ?? { content: '', completed: true };
      const status = context.signal?.aborted
        ? 'interrupted'
        : output.content.startsWith('Error: ') ? 'failed' : 'completed';
      await this.deps.sessionService.setDelegationStatus(child.sessionId, status);
      this.publish(context, child.sessionId, request.task, status, usage);
      return { childSessionId: child.sessionId, content: output.content, status, usage };
    } catch (error) {
      agent?.interrupt();
      const status = context.signal?.aborted ? 'interrupted' : 'failed';
      await this.deps.sessionService.setDelegationStatus(child.sessionId, status);
      const content = error instanceof Error ? error.message : String(error);
      this.publish(context, child.sessionId, request.task, status);
      return { childSessionId: child.sessionId, content, status };
    }
  }

  private publish(
    context: DelegationContext,
    childSessionId: string,
    summary: string,
    status: 'running' | 'completed' | 'failed' | 'interrupted',
    tokenUsage?: import('@earendil-works/pi-ai').Usage,
  ): void {
    this.deps.publish({
      type: 'child-agent-update', workspace: context.workspace,
      sessionId: context.parentSessionId, childSessionId,
      toolCallId: context.parentToolCallId, summary, status, tokenUsage,
    });
  }
}
