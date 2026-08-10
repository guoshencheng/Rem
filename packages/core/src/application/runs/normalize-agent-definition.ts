import type { AgentDefinition, RunTriggerType } from '../../domain/agent-definition/types.js';
import { cloneCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { assertAgentDefinitionContextConfiguration } from './validate-run-contexts.js';

type RecordValue = Record<string, unknown>;

const ALLOWED_FIELDS = [
  'agentId', 'revision', 'name', 'instructions', 'modelId', 'toolNames', 'acceptedTriggers',
  'requiredContexts', 'optionalContexts', 'overridableContexts', 'execution',
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
  assertAllowedKeys(execution, ['type'], 'AgentDefinition.execution');
  if (execution.type !== 'single-agent') invalid('AgentDefinition.execution.type must be single-agent');
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
