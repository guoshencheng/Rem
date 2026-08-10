import type { ContextPatch } from '../../domain/context/types.js';
import type { RunTrigger } from '../../domain/run/types.js';
import type { StartRunInput } from './types.js';
import { cloneCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { assertContextPatchShape } from './validate-run-contexts.js';

type RecordValue = Record<string, unknown>;

export function validateStartRunInput(request: unknown, input: unknown): StartRunInput {
  const requestRecord = requireRecord(request, 'request');
  const principal = requireRecord(requestRecord.principal, 'request.principal');
  requireNonEmptyText(requestRecord.tenantId, 'request.tenantId');
  requireNonEmptyText(principal.principalId, 'request.principal.principalId');
  if (!Array.isArray(principal.roles)
    || principal.roles.some((role) => typeof role !== 'string' || !role.trim())) {
    invalid('request.principal.roles must be an array of non-empty strings');
  }

  const value = requireRecord(input, 'input');
  const agentId = requireNonEmptyText(value.agentId, 'input.agentId');
  const agentRevision = optionalNonEmptyText(value.agentRevision, 'input.agentRevision');
  const sessionId = optionalNonEmptyText(value.sessionId, 'input.sessionId');
  const idempotencyKey = optionalNonEmptyText(value.idempotencyKey, 'input.idempotencyKey');
  if (!Object.hasOwn(value, 'trigger')) invalid('input.trigger is required');

  const trigger = cloneJson<RunTrigger>(value.trigger, 'trigger');
  assertTrigger(trigger);
  const contexts = value.contexts === undefined
    ? undefined
    : cloneJson<ContextPatch>(value.contexts, 'contexts');
  if (contexts !== undefined) assertContextPatchShape(contexts);

  return {
    agentId,
    ...(agentRevision === undefined ? {} : { agentRevision }),
    ...(sessionId === undefined ? {} : { sessionId }),
    trigger,
    ...(contexts === undefined ? {} : { contexts }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

function assertTrigger(trigger: unknown): asserts trigger is RunTrigger {
  const value = requireRecord(trigger, 'trigger');
  if (value.type === 'task') {
    assertKeys(value, ['type', 'input'], [], 'task trigger');
    return;
  }
  if (value.type === 'message') {
    assertKeys(value, ['type', 'content'], [], 'message trigger');
    assertMessageContent(value.content);
    return;
  }
  invalid('trigger.type must be message or task');
}

function assertMessageContent(content: unknown): void {
  if (typeof content === 'string') return;
  if (!Array.isArray(content)) invalid('message trigger content must be a string or content block array');
  const records = content.map((block, index) => requireRecord(block, `message content[${index}]`));
  const types = records.map((block) => block.type);
  const userBlocks = types.every((type) => type === 'text' || type === 'image');
  const assistantBlocks = types.every((type) => type === 'text' || type === 'thinking' || type === 'toolCall');
  if (!userBlocks && !assistantBlocks) invalid('message trigger content mixes incompatible block types');
  records.forEach(assertContentBlock);
}

function assertContentBlock(value: RecordValue): void {
  if (value.type === 'text') {
    assertKeys(value, ['type', 'text'], ['textSignature'], 'text block');
    requireText(value.text, 'text block.text'); optionalText(value.textSignature, 'text block.textSignature'); return;
  }
  if (value.type === 'image') {
    assertKeys(value, ['type', 'data', 'mimeType'], [], 'image block');
    requireText(value.data, 'image block.data'); requireText(value.mimeType, 'image block.mimeType'); return;
  }
  if (value.type === 'thinking') {
    assertKeys(value, ['type', 'thinking'], ['thinkingSignature', 'redacted'], 'thinking block');
    requireText(value.thinking, 'thinking block.thinking'); optionalText(value.thinkingSignature, 'thinking block.thinkingSignature');
    if (value.redacted !== undefined && typeof value.redacted !== 'boolean') invalid('thinking block.redacted must be a boolean');
    return;
  }
  if (value.type === 'toolCall') {
    assertKeys(value, ['type', 'id', 'name', 'arguments'], ['thoughtSignature'], 'toolCall block');
    requireNonEmptyText(value.id, 'toolCall block.id'); requireNonEmptyText(value.name, 'toolCall block.name');
    requireRecord(value.arguments, 'toolCall block.arguments'); optionalText(value.thoughtSignature, 'toolCall block.thoughtSignature');
    return;
  }
  invalid('Unknown message content block type');
}

function assertKeys(value: RecordValue, required: string[], optional: string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) {
    invalid(`${label} has invalid fields`);
  }
}

function cloneJson<T>(value: unknown, label: string): T {
  try { return cloneCanonicalJson(value) as T; }
  catch (cause) {
    throw new RuntimeError('INVALID_INPUT', `${label} must be JSON-compatible`, false, undefined, { cause });
  }
}

function requireRecord(value: unknown, label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label} must be a plain object`);
  return value as RecordValue;
}

function requireNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${label} must be a non-empty string`);
  return value;
}

function requireText(value: unknown, label: string): void {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
}

function optionalNonEmptyText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireNonEmptyText(value, label);
}

function optionalText(value: unknown, label: string): void {
  if (value !== undefined) requireText(value, label);
}

function invalid(message: string): never {
  throw new RuntimeError('INVALID_INPUT', message);
}
