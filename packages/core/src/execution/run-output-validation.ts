import type { Message } from '@earendil-works/pi-ai';
import type { ArtifactDraft } from '../domain/artifact/types.js';
import type { RunExecutionResult } from './run-executor.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';

type JsonRecord = Record<string, unknown>;

export interface ValidatedRunOutput {
  sessionEntries: Array<{ message: Message; metadata?: Record<string, unknown> }>;
  artifacts: ArtifactDraft[];
}

export function validateRunOutput(value: unknown): ValidatedRunOutput {
  let cloned: unknown;
  try { cloned = cloneCanonicalJson(value); }
  catch (cause) { return invalid('Executor result must be JSON-compatible', cause); }
  const result = record(cloned, 'executor result');
  if (!Array.isArray(result.sessionEntries) || !Array.isArray(result.artifacts)) {
    return invalid('Executor result must contain sessionEntries and artifacts arrays');
  }
  const sessionEntries = result.sessionEntries.map((item, index) => {
    const entry = record(item, `sessionEntries[${index}]`);
    validateMessage(entry.message, `sessionEntries[${index}].message`);
    const metadata = entry.metadata === undefined
      ? undefined
      : record(entry.metadata, `sessionEntries[${index}].metadata`);
    return { message: entry.message as Message, ...(metadata === undefined ? {} : { metadata }) };
  });
  const artifacts = result.artifacts.map((item, index) => validateArtifact(item, index));
  return { sessionEntries, artifacts };
}

function validateArtifact(value: unknown, index: number): ArtifactDraft {
  const artifact = record(value, `artifacts[${index}]`);
  const type = text(artifact.type, `artifacts[${index}].type`);
  const mediaType = text(artifact.mediaType, `artifacts[${index}].mediaType`);
  const name = text(artifact.name, `artifacts[${index}].name`);
  const data = optionalText(artifact.data, `artifacts[${index}].data`, true);
  const uri = optionalText(artifact.uri, `artifacts[${index}].uri`, false);
  const metadata = artifact.metadata === undefined ? undefined : record(artifact.metadata, `artifacts[${index}].metadata`);
  return { type, mediaType, name, ...(data === undefined ? {} : { data }),
    ...(uri === undefined ? {} : { uri }), ...(metadata === undefined ? {} : { metadata }) };
}

function validateMessage(value: unknown, label: string): void {
  const message = record(value, label);
  if (!Number.isFinite(message.timestamp)) invalid(`${label}.timestamp must be finite`);
  if (message.role === 'user') {
    if (typeof message.content === 'string') return;
    validateBlocks(message.content, `${label}.content`, ['text', 'image']); return;
  }
  if (message.role === 'assistant') {
    validateBlocks(message.content, `${label}.content`, ['text', 'thinking', 'toolCall']);
    text(message.api, `${label}.api`); text(message.provider, `${label}.provider`); text(message.model, `${label}.model`);
    for (const key of ['responseModel', 'responseId', 'errorMessage']) optionalText(message[key], `${label}.${key}`, true);
    if (message.diagnostics !== undefined) {
      if (!Array.isArray(message.diagnostics)) invalid(`${label}.diagnostics must be an array`);
      message.diagnostics.forEach((item, index) => validateDiagnostic(item, `${label}.diagnostics[${index}]`));
    }
    const usage = record(message.usage, `${label}.usage`); validateUsage(usage, `${label}.usage`);
    if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(message.stopReason))) invalid(`${label}.stopReason is invalid`);
    return;
  }
  if (message.role === 'toolResult') {
    text(message.toolCallId, `${label}.toolCallId`); text(message.toolName, `${label}.toolName`);
    validateBlocks(message.content, `${label}.content`, ['text', 'image']);
    if (typeof message.isError !== 'boolean') invalid(`${label}.isError must be boolean`);
    if (message.usage !== undefined) validateUsage(record(message.usage, `${label}.usage`), `${label}.usage`);
    if (message.addedToolNames !== undefined) {
      if (!Array.isArray(message.addedToolNames)) invalid(`${label}.addedToolNames must be an array`);
      message.addedToolNames.forEach((name, index) => text(name, `${label}.addedToolNames[${index}]`, true));
    }
    return;
  }
  invalid(`${label}.role is invalid`);
}

function validateUsage(value: JsonRecord, label: string): void {
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) finite(value[key], `${label}.${key}`);
  for (const key of ['cacheWrite1h', 'reasoning']) if (value[key] !== undefined) finite(value[key], `${label}.${key}`);
  const cost = record(value.cost, `${label}.cost`);
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) finite(cost[key], `${label}.cost.${key}`);
}

function validateBlocks(value: unknown, label: string, allowed: string[]): void {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  value.forEach((item, index) => {
    const block = record(item, `${label}[${index}]`);
    if (!allowed.includes(String(block.type))) invalid(`${label}[${index}].type is invalid`);
    if (block.type === 'text') {
      text(block.text, `${label}[${index}].text`, true);
      optionalText(block.textSignature, `${label}[${index}].textSignature`, true);
    }
    else if (block.type === 'image') { text(block.data, `${label}[${index}].data`, true); text(block.mimeType, `${label}[${index}].mimeType`, true); }
    else if (block.type === 'thinking') {
      text(block.thinking, `${label}[${index}].thinking`, true);
      optionalText(block.thinkingSignature, `${label}[${index}].thinkingSignature`, true);
      if (block.redacted !== undefined && typeof block.redacted !== 'boolean') invalid(`${label}[${index}].redacted must be boolean`);
    } else {
      text(block.id, `${label}[${index}].id`); text(block.name, `${label}[${index}].name`);
      record(block.arguments, `${label}[${index}].arguments`);
      optionalText(block.thoughtSignature, `${label}[${index}].thoughtSignature`, true);
    }
  });
}

function validateDiagnostic(value: unknown, label: string): void {
  const diagnostic = record(value, label);
  text(diagnostic.type, `${label}.type`); finite(diagnostic.timestamp, `${label}.timestamp`);
  if (diagnostic.error !== undefined) {
    const error = record(diagnostic.error, `${label}.error`);
    text(error.message, `${label}.error.message`, true);
    optionalText(error.name, `${label}.error.name`, true); optionalText(error.stack, `${label}.error.stack`, true);
    if (error.code !== undefined && typeof error.code !== 'string') finite(error.code, `${label}.error.code`);
  }
  if (diagnostic.details !== undefined) record(diagnostic.details, `${label}.details`);
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label} must be a plain object`);
  return value as JsonRecord;
}
function text(value: unknown, label: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value)) invalid(`${label} must be ${empty ? 'a string' : 'non-empty text'}`);
  return value;
}
function optionalText(value: unknown, label: string, empty: boolean): string | undefined {
  return value === undefined ? undefined : text(value, label, empty);
}
function finite(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be finite`);
}
function invalid(message: string, cause?: unknown): never {
  throw new RuntimeError('INTERNAL_ERROR', message, false, undefined, cause === undefined ? undefined : { cause });
}
