import type { Models } from '@earendil-works/pi-ai';
import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { RunLiveSignalDraft } from '../domain/event/live-signals.js';
import type { AgentSession } from '../domain/session/types.js';
import type { AgentRun } from '../domain/run/types.js';
import type { RunDelivery, RunExecutionEntry, RunExecutionNode } from '../domain/run/execution-models.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type { AgentDefinitionProvider } from '../sdk/agent-definition-provider.js';
import type { RuntimeConfigProvider } from '../sdk/runtime-config-provider.js';
import type { RuntimePluginHost } from '../plugin-system/runtime-plugin-host.js';
import type { RunExecutionResult, RunExecutor } from './run-executor.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { LinkedAbortController } from './linked-abort-controller.js';
import { SingleAgentRunExecutor } from './single-agent-run-executor.js';
import { createTeamRunActions } from './team-run-actions.js';
import { cancelTeamDeliveries, claimTeamDelivery, completeTeamDelivery, failTeamDelivery, lastAssistantEntry, markTeamDeliveryWaiting } from './team-delivery-scheduler.js';
import { projectTeamNodeTranscript } from './team-transcript-projector.js';
import { resolveRunConfig } from './runtime-agent-config.js';
import type { RunLiveSignalProjectorState } from './run-live-signal-projector.js';
import type { RuntimeObservationSink } from '../sdk/runtime-observer.js';

export interface TeamRunExecutorOptions {
  models: Models;
  config: RuntimeConfigProvider;
  executionRoot: string;
  agentDefinitions: AgentDefinitionProvider;
  storage: RuntimeStorage;
  pluginHost: RuntimePluginHost;
  observe?: RuntimeObservationSink;
}

interface DeliveryOutcome { deliveryId: string; result?: RunExecutionResult; error?: unknown; final?: boolean; }

/** Organizer-first Team scheduler backed by the root Run's durable deliveries. */
export class TeamRunExecutor implements RunExecutor {
  private readonly single: SingleAgentRunExecutor;
  constructor(private readonly options: TeamRunExecutorOptions) { this.single = new SingleAgentRunExecutor(options); }

  async execute(input: { run: AgentRun; session: AgentSession; signal: AbortSignal; emitSignal?: (signal: RunLiveSignalDraft) => void; observe?: RuntimeObservationSink }): Promise<RunExecutionResult> {
    const plan = input.run.executionPlanSnapshot;
    if (!plan || plan.executionType !== 'team') return this.single.execute(input);
    const linked = new LinkedAbortController(input.signal);
    const active = new Map<string, Promise<DeliveryOutcome>>();
    const activeNodes = new Set<string>();
    const liveSignalState: RunLiveSignalProjectorState = { nextMessageIndex: 0 };
    const limit = Math.max(1, plan.limits.maxParallelAgents);
    let final: RunExecutionResult | undefined;
    let fatal: unknown;
    try {
      for (;;) {
        while (active.size < limit && fatal === undefined && final === undefined) {
          const delivery = await claimTeamDelivery(this.options.storage, input.run.runId, activeNodes, new Date());
          if (!delivery) break;
          activeNodes.add(delivery.nodeId);
          const task = this.executeDelivery(input, delivery, linked.controller.signal, liveSignalState)
            .catch(async (error): Promise<DeliveryOutcome> => {
              await this.recordUnexpectedDeliveryFailure(input.run, delivery, error);
              return { deliveryId: delivery.deliveryId, error };
            })
            .then((outcome) => {
            activeNodes.delete(delivery.nodeId); return outcome;
          });
          active.set(delivery.deliveryId, task);
        }
        if (active.size === 0) {
          if (fatal !== undefined) throw fatal;
          if (final !== undefined) return final;
          const pending = await this.hasPending(input.run.runId);
          if (pending) continue;
          throw new RuntimeError('MODEL_EXECUTION_FAILED', 'Team organizer did not produce a final result');
        }
        const settled = await Promise.race([...active.values()]);
        active.delete(settled.deliveryId);
        if (settled.error !== undefined) {
          if (settled.error instanceof RuntimeError && settled.error.code === 'TOOL_RESULT_UNKNOWN') fatal ??= settled.error;
          else if (await this.isOrganizerDelivery(input.run.runId, settled.deliveryId)) { fatal ??= settled.error; linked.controller.abort(); }
        }
        if (settled.final && settled.result) final = settled.result;
      }
    } finally {
      linked.dispose();
    }
  }

  private async executeDelivery(
    input: { run: AgentRun; session: AgentSession; signal: AbortSignal; emitSignal?: (signal: RunLiveSignalDraft) => void; observe?: RuntimeObservationSink },
    delivery: RunDelivery,
    signal: AbortSignal,
    liveSignalState: RunLiveSignalProjectorState,
  ): Promise<DeliveryOutcome> {
    const now = new Date();
    const context = await this.options.storage.transaction((uow) => {
      const node = uow.executionNodes.get(delivery.nodeId);
      if (!node) throw new RuntimeError('STORAGE_UNAVAILABLE', 'Team execution node is missing', true);
      const transcript = projectTeamNodeTranscript(uow, input.run.runId, node.nodeId, delivery);
      return { node, transcript, beforeSequence: transcript.at(-1)?.sequence ?? 0 };
    });
    const participant = input.run.executionPlanSnapshot?.participantSnapshots.find((candidate) =>
      candidate.agentId === context.node.agentId && candidate.revision === context.node.agentRevision && candidate.role === context.node.role);
    if (!participant) return this.failDelivery(input.run, delivery, 'INTERNAL_ERROR', signal);
    const definition = definitionFromSnapshot(participant);
    const model = resolveRunConfig(this.options.config, definition, input.run).model;
    const actions = createTeamRunActions({ storage: this.options.storage, run: input.run, currentNode: context.node, currentDelivery: delivery, model });
    const nodeRun: AgentRun = { ...input.run, agentId: participant.agentId, agentRevision: participant.revision, rootNodeId: context.node.nodeId, executionType: 'team' };
    try {
      const result = await this.single.execute({
        run: nodeRun, session: input.session, signal, definitionOverride: definition,
        transcriptEntries: context.transcript, orchestration: {
          nodeId: context.node.nodeId, sendMessage: actions.sendMessage, canSubmitResult: actions.canSubmitResult,
          allowIntermediate: true, requiresFinal: context.node.role === 'organizer',
        }, suppressUserMessagePersistence: true, emitSignal: input.emitSignal, liveSignalState,
        observe: input.observe ?? this.options.observe,
      });
      const finalizable = await actions.canSubmitResult();
      const organizerFinal = context.node.role === 'organizer' && finalizable && result.artifacts.length > 0;
      const resultEntry = await lastAssistantEntry(this.options.storage, input.run.runId, context.node.nodeId, context.beforeSequence);
      await completeTeamDelivery(this.options.storage, input.run, delivery.deliveryId, resultEntry?.entryId, now);
      return { deliveryId: delivery.deliveryId, result, final: organizerFinal };
    } catch (error) {
      if (error instanceof RuntimeError && error.code === 'TOOL_RESULT_UNKNOWN') {
        await markTeamDeliveryWaiting(this.options.storage, input.run, delivery.deliveryId, new Date(), error.code);
        return { deliveryId: delivery.deliveryId, error };
      }
      // A cancelled/ timed-out non-idempotent tool is recorded as `unknown`
      // before the executor observes the abort.  Keep the delivery in the
      // same waiting state so a later resolution can requeue this exact node
      // instead of leaving a failed delivery with no resumable work.
      if (error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED'
        && await this.hasUnknownInvocation(input.run.runId, context.node.nodeId)) {
        await markTeamDeliveryWaiting(this.options.storage, input.run, delivery.deliveryId, new Date(), 'TOOL_RESULT_UNKNOWN');
        return { deliveryId: delivery.deliveryId, error: new RuntimeError('TOOL_RESULT_UNKNOWN', 'Tool invocation result is unknown') };
      }
      if (context.node.role === 'organizer' || error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED') {
        await completeTeamDelivery(this.options.storage, input.run, delivery.deliveryId, undefined, new Date(), error instanceof RuntimeError ? error.code : 'MODEL_EXECUTION_FAILED');
        if (context.node.role === 'organizer') await cancelTeamDeliveries(this.options.storage, input.run, new Date(), delivery.deliveryId);
        return { deliveryId: delivery.deliveryId, error };
      }
      return this.failDelivery(input.run, delivery, error instanceof RuntimeError ? error.code : 'MODEL_EXECUTION_FAILED', signal);
    }
  }

  private async failDelivery(run: AgentRun, delivery: RunDelivery, errorCode: string, _signal: AbortSignal): Promise<DeliveryOutcome> {
    await failTeamDelivery(this.options.storage, run, delivery.deliveryId, errorCode, new Date());
    return { deliveryId: delivery.deliveryId };
  }

  private async recordUnexpectedDeliveryFailure(run: AgentRun, delivery: RunDelivery, error: unknown): Promise<void> {
    const code = error instanceof RuntimeError ? error.code : 'MODEL_EXECUTION_FAILED';
    const organizer = await this.isOrganizerDelivery(run.runId, delivery.deliveryId);
    if (code === 'TOOL_RESULT_UNKNOWN') {
      await markTeamDeliveryWaiting(this.options.storage, run, delivery.deliveryId, new Date(), code);
    } else if (organizer) {
      await completeTeamDelivery(this.options.storage, run, delivery.deliveryId, undefined, new Date(), code);
      await cancelTeamDeliveries(this.options.storage, run, new Date(), delivery.deliveryId);
    } else {
      await failTeamDelivery(this.options.storage, run, delivery.deliveryId, code, new Date());
    }
  }

  private async hasPending(runId: string): Promise<boolean> {
    return this.options.storage.transaction((uow) => uow.deliveries.listByRun(runId).some((delivery) => ['queued', 'running', 'waiting'].includes(delivery.status)));
  }

  private async isOrganizerDelivery(runId: string, deliveryId: string): Promise<boolean> {
    return this.options.storage.transaction((uow) => {
      const delivery = uow.deliveries.get(deliveryId);
      const node = delivery ? uow.executionNodes.get(delivery.nodeId) : null;
      return node?.role === 'organizer';
    });
  }

  private async hasUnknownInvocation(runId: string, nodeId: string): Promise<boolean> {
    return this.options.storage.transaction((uow) => uow.toolInvocations.listByRun(runId)
      .some((invocation) => invocation.nodeId === nodeId && invocation.status === 'unknown'));
  }
}

function definitionFromSnapshot(snapshot: {
  agentId: string; revision: string; name: string; instructions: string; modelId: string;
  toolNames: readonly string[]; acceptedTriggers: readonly ('message' | 'task')[];
  inputSchema?: AgentDefinition['inputSchema']; outputSchema?: AgentDefinition['outputSchema'];
  delegation?: AgentDefinition['execution']['delegation'];
}): AgentDefinition {
  return {
    agentId: snapshot.agentId, revision: snapshot.revision, name: snapshot.name,
    instructions: snapshot.instructions, modelId: snapshot.modelId, toolNames: [...snapshot.toolNames],
    acceptedTriggers: [...snapshot.acceptedTriggers], execution: {
      type: 'single-agent', ...(snapshot.delegation === undefined ? {} : { delegation: structuredClone(snapshot.delegation) }),
    },
    ...(snapshot.inputSchema === undefined ? {} : { inputSchema: structuredClone(snapshot.inputSchema) }),
    ...(snapshot.outputSchema === undefined ? {} : { outputSchema: structuredClone(snapshot.outputSchema) }),
  };
}
