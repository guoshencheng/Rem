import type { ContextPatch } from '../../domain/context/types.js';
import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { RunTrigger } from '../../domain/run/types.js';
import type { NormalizedStartRunRequest, StartRunInput } from './types.js';
import { cloneCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { assertContextPatchShape } from './validate-run-contexts.js';
import { isUserMessageContent } from '../../domain/run/message-trigger-content.js';

type RecordValue = Record<string, unknown>;

export function validateStartRunInput(request: unknown, input: unknown): NormalizedStartRunRequest {
  const requestRecord = requireRecord(cloneJson(request, 'request'), 'request');
  const principal = requireRecord(requestRecord.principal, 'request.principal');
  const tenantId = requireNonEmptyText(requestRecord.tenantId, 'request.tenantId');
  const principalId = requireNonEmptyText(principal.principalId, 'request.principal.principalId');
  if (!Array.isArray(principal.roles)
    || principal.roles.some((role) => typeof role !== 'string' || !role.trim())) {
    invalid('request.principal.roles must be an array of non-empty strings');
  }
  const roles = [...principal.roles] as string[];
  const claims = Object.hasOwn(principal, 'claims')
    ? requireRecord(principal.claims, 'request.principal.claims')
    : undefined;
  const normalizedRequest: RuntimeRequestContext = {
    tenantId,
    principal: { principalId, roles, ...(claims === undefined ? {} : { claims }) },
  };

  const value = requireRecord(input, 'input');
  const agentId = requireNonEmptyText(readDataProperty(value, 'agentId'), 'input.agentId');
  const agentRevision = optionalNonEmptyText(readDataProperty(value, 'agentRevision'), 'input.agentRevision');
  const sessionId = optionalNonEmptyText(readDataProperty(value, 'sessionId'), 'input.sessionId');
  const idempotencyKey = optionalNonEmptyText(readDataProperty(value, 'idempotencyKey'), 'input.idempotencyKey');
  if (!Object.hasOwn(value, 'trigger')) invalid('input.trigger is required');

  const trigger = cloneJson<RunTrigger>(readDataProperty(value, 'trigger'), 'trigger');
  assertTrigger(trigger);
  const contextValue = readDataProperty(value, 'contexts');
  const contexts = contextValue === undefined
    ? undefined
    : cloneJson<ContextPatch>(contextValue, 'contexts');
  if (contexts !== undefined) assertContextPatchShape(contexts);

  return { request: normalizedRequest, input: {
    agentId, ...(agentRevision === undefined ? {} : { agentRevision }),
    ...(sessionId === undefined ? {} : { sessionId }), trigger,
    ...(contexts === undefined ? {} : { contexts }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  } };
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
  if (!isUserMessageContent(content)) invalid('message trigger content must contain only user text/image blocks');
  if (typeof content === 'string') return;
  const records = content.map((block, index) => requireRecord(block, `message content[${index}]`));
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
  invalid('Unknown message content block type');
}

function assertKeys(value: RecordValue, required: string[], optional: string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) {
    invalid(`${label} has invalid fields`);
  }
}

function cloneJson<T = unknown>(value: unknown, label: string): T {
  try { return cloneCanonicalJson(value) as T; }
  catch (cause) {
    throw new RuntimeError('INVALID_INPUT', `${label} must be JSON-compatible`, false, undefined, { cause });
  }
}

function readDataProperty(value: RecordValue, property: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) {
    const cause = new Error(`Accessor property is not JSON-compatible: ${property}`);
    throw new RuntimeError('INVALID_INPUT', `input.${property} must be JSON-compatible`, false, undefined, { cause });
  }
  return descriptor.value;
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
