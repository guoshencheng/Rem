import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentRun } from '../domain/run/types.js';
import type { RunDelivery, RunExecutionNode } from '../domain/run/execution-models.js';
import type { ResolvedRuntimeModelConfig } from '../sdk/runtime-config-provider.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type { RuntimeSendMessageActions, RuntimeSendMessageInput } from './runtime-send-message-tool.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { generateId } from '../shared/generate-id.js';
import { consumeExecutionMessage } from './run-execution-budget.js';

export interface TeamRunActionOptions {
  storage: RuntimeStorage;
  run: AgentRun;
  currentNode: RunExecutionNode;
  currentDelivery: RunDelivery;
  model: ResolvedRuntimeModelConfig;
}

export function createTeamRunActions(options: TeamRunActionOptions): RuntimeSendMessageActions & { canSubmitResult(): Promise<boolean> } {
  return {
    canSubmitResult: async () => options.storage.transaction((uow) => uow.deliveries.listByRun(options.run.runId)
      .filter((delivery) => delivery.deliveryId !== options.currentDelivery.deliveryId)
      .every((delivery) => !['queued', 'running', 'waiting'].includes(delivery.status))),
    sendMessage: async (input, invocationId) => {
      // Tool call ids are only unique within a node.  Include the requester
      // node in the deterministic batch key so two agents replaying the same
      // call id cannot share a communication entry or resume delivery.
      const batchId = `${options.run.runId}:message:${encodeURIComponent(options.currentNode.nodeId)}:${encodeURIComponent(invocationId ?? generateId())}`;
      const entryId = `${batchId}:entry`;
      const at = new Date();
      const nextDepth = options.currentDelivery.depth + 1;
      const limits = options.run.executionPlanSnapshot?.limits;
      if (limits && nextDepth > limits.maxDepth) {
        throw new RuntimeError('RUN_CONFLICT', 'Execution delivery depth is exhausted', false, {
          reason: 'maxDepth', max: limits.maxDepth, actual: nextDepth,
        });
      }
      return options.storage.transaction((uow) => {
        const existing = uow.executionEntries.get(entryId);
        if (existing) return { batchId };
        const targets = resolveTargets(uow.executionNodes.listByRun(options.run.runId), input.to, options.currentNode.nodeId);
        const message = communicationMessage(input.content, options.model, at);
        // The central communication entry is a durable assistant message. Count
        // it in the same transaction as the entry and deliveries so a budget
        // rejection cannot leave a half-created batch behind.
        consumeExecutionMessage(uow, options.run, message, at);
        uow.executionEntries.append({
          entryId, tenantId: options.run.tenantId, runId: options.run.runId,
          nodeId: options.currentNode.nodeId, sequence: uow.executionEntries.nextSequence(options.run.runId),
          kind: 'message', message, data: { kind: 'team.communication', to: [...input.to] }, audience: 'internal', visibility: 'run', createdAt: new Date(at.getTime()),
        });
        for (const target of targets) {
          const deliveryId = runtimeMessageDeliveryId(options.run.runId, batchId, target.nodeId);
          if (uow.deliveries.get(deliveryId)) continue;
          uow.deliveries.insert({
            deliveryId, tenantId: options.run.tenantId, runId: options.run.runId, nodeId: target.nodeId,
            kind: 'message', batchId, depth: nextDepth, status: 'queued', attempt: 0,
            requestedByNodeId: options.currentNode.nodeId, sourceEntryId: entryId,
            createdAt: new Date(at.getTime()), updatedAt: new Date(at.getTime()),
          });
          if (target.status === 'idle') uow.executionNodes.update({ ...target, status: 'queued', updatedAt: new Date(at.getTime()) });
        }
        return { batchId };
      });
    },
  };
}

function resolveTargets(nodes: RunExecutionNode[], agentIds: readonly string[], currentNodeId: string): RunExecutionNode[] {
  const targets: RunExecutionNode[] = [];
  const current = nodes.find((node) => node.nodeId === currentNodeId);
  for (const agentId of agentIds) {
    if (current?.agentId === agentId) throw new RuntimeError('INVALID_INPUT', 'Team agents cannot send messages to themselves');
    const target = nodes.find((node) => (node.kind === 'organizer' || node.kind === 'member' || node.kind === 'root')
      && node.agentId === agentId && node.nodeId !== currentNodeId);
    if (!target) throw new RuntimeError('INVALID_INPUT', `Unknown Team target: ${agentId}`);
    if (target.status === 'completed' || target.status === 'failed' || target.status === 'cancelled') {
      throw new RuntimeError('RUN_CONFLICT', `Team target is terminal: ${agentId}`);
    }
    if (targets.some((candidate) => candidate.nodeId === target.nodeId)) throw new RuntimeError('INVALID_INPUT', 'Team targets must be unique');
    targets.push(target);
  }
  return targets;
}

function communicationMessage(content: string, model: ResolvedRuntimeModelConfig, at: Date): AssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text: content }], api: 'runtime', provider: model.provider,
    model: model.model, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: at.getTime(),
  } as AssistantMessage;
}

export function runtimeMessageDeliveryId(runId: string, batchId: string, nodeId: string): string {
  return `${runId}:message:${encodeURIComponent(batchId)}:${encodeURIComponent(nodeId)}`;
}
