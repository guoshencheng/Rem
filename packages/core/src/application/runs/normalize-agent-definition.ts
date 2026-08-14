import type { AgentDefinition, RunTriggerType } from '../../domain/agent-definition/types.js';
import type { AgentRef, DelegationDefinition } from '../../domain/agent-definition/execution-types.js';
import { cloneCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { assertAgentDefinitionContextConfiguration } from './validate-run-contexts.js';
import { normalizeJsonSchema } from './json-schema-validation.js';

type RecordValue = Record<string, unknown>;

const ALLOWED_FIELDS = [
  'agentId', 'revision', 'name', 'instructions', 'modelId', 'toolNames', 'acceptedTriggers',
  'requiredContexts', 'optionalContexts', 'overridableContexts', 'inputSchema', 'outputSchema', 'execution',
] as const;
const TRIGGERS = new Set<RunTriggerType>(['message', 'task']);

export function normalizeAgentDefinition(
  value: unknown,
  expectedAgentId: string,
  expectedRevision?: string,
): AgentDefinition {
  try {
    const definition = requireRecord(cloneCanonicalJson(value), 'AgentDefinition');
    assertAllowedKeys(definition, ALLOWED_FIELDS, 'AgentDefinition');
    const agentId = requireNonEmptyText(definition.agentId, 'AgentDefinition.agentId');
    const revision = requireNonEmptyText(definition.revision, 'AgentDefinition.revision');
    requireNonEmptyText(definition.name, 'AgentDefinition.name');
    requireNonEmptyText(definition.instructions, 'AgentDefinition.instructions');
    requireNonEmptyText(definition.modelId, 'AgentDefinition.modelId');
    assertUniqueTextArray(definition.toolNames, 'AgentDefinition.toolNames');
    assertTriggers(definition.acceptedTriggers);
    if (definition.inputSchema !== undefined) definition.inputSchema = normalizeJsonSchema(definition.inputSchema, 'AgentDefinition.inputSchema');
    if (definition.outputSchema !== undefined) definition.outputSchema = normalizeJsonSchema(definition.outputSchema, 'AgentDefinition.outputSchema');
    assertExecution(definition.execution);
    if (agentId !== expectedAgentId) invalid('AgentDefinition.agentId does not match request');
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      invalid('AgentDefinition.revision does not match request');
    }
    assertAgentDefinitionContextConfiguration(definition as unknown as AgentDefinition);
    return definition as unknown as AgentDefinition;
  } catch (cause) {
    throw new RuntimeError('INTERNAL_ERROR', 'Agent definition is invalid', false, undefined, { cause });
  }
}

function assertTriggers(value: unknown): void {
  if (!Array.isArray(value)) invalid('AgentDefinition.acceptedTriggers must be an array');
  const seen = new Set<string>();
  value.forEach((trigger, index) => {
    if (typeof trigger !== 'string' || !TRIGGERS.has(trigger as RunTriggerType)) {
      invalid(`AgentDefinition.acceptedTriggers[${index}] is invalid`);
    }
    if (seen.has(trigger)) invalid(`Duplicate accepted trigger: ${trigger}`);
    seen.add(trigger);
  });
}

function assertUniqueTextArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const text = requireNonEmptyText(item, `${label}[${index}]`);
    if (seen.has(text)) invalid(`Duplicate ${label} item: ${text}`);
    seen.add(text);
  });
}

function assertExecution(value: unknown): void {
  const execution = requireRecord(value, 'AgentDefinition.execution');
  if (execution.type === 'single-agent') {
    assertAllowedKeys(execution, ['type', 'delegation'], 'AgentDefinition.execution');
    if (execution.delegation !== undefined) assertDelegation(execution.delegation);
    return;
  }
  if (execution.type !== 'team') invalid('AgentDefinition.execution.type must be single-agent or team');
  assertAllowedKeys(execution, ['type', 'members', 'limits', 'delegation'], 'AgentDefinition.execution');
  if (!Array.isArray(execution.members) || execution.members.length === 0) invalid('AgentDefinition.execution.members must be non-empty');
  const seen = new Set<string>();
  execution.members.forEach((member, index) => {
    const value = requireRecord(member, `AgentDefinition.execution.members[${index}]`);
    assertAllowedKeys(value, ['agentId', 'revision'], `AgentDefinition.execution.members[${index}]`);
    const agentId = requireNonEmptyText(value.agentId, `AgentDefinition.execution.members[${index}].agentId`);
    const revision = value.revision === undefined ? undefined : requireNonEmptyText(value.revision, `AgentDefinition.execution.members[${index}].revision`);
    const key = `${agentId}\u0000${revision ?? ''}`;
    if (seen.has(key)) invalid('AgentDefinition.execution.members must be unique');
    seen.add(key);
  });
  if (execution.limits !== undefined) {
    const limits = requireRecord(execution.limits, 'AgentDefinition.execution.limits');
    for (const key of ['maxAgentRuns', 'maxMessages', 'maxDepth', 'timeoutMs', 'maxTokens', 'maxParallelAgents']) {
      if (limits[key] !== undefined && (!Number.isSafeInteger(limits[key]) || (limits[key] as number) <= 0)) {
        invalid(`AgentDefinition.execution.limits.${key} must be a positive integer`);
      }
    }
  }
  if (execution.delegation !== undefined) assertDelegation(execution.delegation);
}

function assertDelegation(value: unknown): asserts value is DelegationDefinition {
  const delegation = requireRecord(value, 'AgentDefinition.execution.delegation');
  assertAllowedKeys(delegation, ['enabled', 'maxDepth'], 'AgentDefinition.execution.delegation');
  if (typeof delegation.enabled !== 'boolean') invalid('AgentDefinition.execution.delegation.enabled must be boolean');
  const maxDepth = delegation.maxDepth;
  if (maxDepth !== undefined && (!Number.isSafeInteger(maxDepth) || (maxDepth as number) < 1 || (maxDepth as number) > 16)) {
    invalid('AgentDefinition.execution.delegation.maxDepth must be an integer from 1 to 16');
  }
}

function requireRecord(value: unknown, label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label} must be a plain object`);
  return value as RecordValue;
}

function assertAllowedKeys(value: RecordValue, allowed: readonly string[], label: string): void {
  const names = new Set(allowed);
  if (Object.keys(value).some((key) => !names.has(key))) invalid(`${label} has invalid fields`);
}

function requireNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${label} must be a non-empty string`);
  return value;
}

function invalid(message: string): never {
  throw new Error(message);
}
