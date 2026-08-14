import type { AgentDefinition } from '../../domain/agent-definition/types.js';
import { DEFAULT_ORCHESTRATION_LIMITS, type AgentPlanParticipant, type AgentPlanParticipantSnapshot, type ExecutionPlanSnapshot, type OrchestrationLimits } from '../../domain/agent-definition/execution-types.js';
import { hashCanonicalJson } from '../contexts/canonical-json.js';

export function buildExecutionPlan(root: AgentDefinition, members: readonly AgentDefinition[] = []): ExecutionPlanSnapshot {
  const executionType = root.execution.type;
  const participants: AgentPlanParticipant[] = executionType === 'team'
    ? [{ agentId: root.agentId, revision: root.revision, role: 'organizer' }, ...members.map((member) => ({ agentId: member.agentId, revision: member.revision, role: 'member' as const }))]
    : [{ agentId: root.agentId, revision: root.revision, role: 'root' }];
  const definitions = [root, ...members];
  const participantSnapshots: AgentPlanParticipantSnapshot[] = definitions.map((definition, index) => {
    const participant = participants[index];
    return {
      ...participant,
      name: definition.name,
      instructions: definition.instructions,
      modelId: definition.modelId,
      toolNames: [...definition.toolNames],
      acceptedTriggers: [...definition.acceptedTriggers],
      ...(definition.inputSchema === undefined ? {} : { inputSchema: structuredClone(definition.inputSchema) }),
      ...(definition.outputSchema === undefined ? {} : { outputSchema: structuredClone(definition.outputSchema) }),
      ...(definition.execution.delegation === undefined ? {} : { delegation: structuredClone(definition.execution.delegation) }),
    };
  });
  const limits = executionType === 'team'
    ? { ...DEFAULT_ORCHESTRATION_LIMITS, ...(root.execution.limits ?? {}) }
    : { ...DEFAULT_ORCHESTRATION_LIMITS };
  const unsigned = {
    orchestrationVersion: 1 as const, executionType, participants, participantSnapshots, modelId: root.modelId, toolNames: [...root.toolNames],
    instructions: root.instructions, limits,
    ...(root.inputSchema === undefined ? {} : { inputSchema: root.inputSchema }),
    ...(root.outputSchema === undefined ? {} : { outputSchema: root.outputSchema }),
  } satisfies Omit<ExecutionPlanSnapshot, 'hash'>;
  return { ...unsigned, hash: hashCanonicalJson(unsigned) };
}

export function isSingleAgentDefinition(definition: AgentDefinition): boolean {
  return definition.execution.type === 'single-agent';
}

export function orchestrationLimits(definition: AgentDefinition): OrchestrationLimits {
  return definition.execution.type === 'team'
    ? { ...DEFAULT_ORCHESTRATION_LIMITS, ...(definition.execution.limits ?? {}) }
    : { ...DEFAULT_ORCHESTRATION_LIMITS };
}
