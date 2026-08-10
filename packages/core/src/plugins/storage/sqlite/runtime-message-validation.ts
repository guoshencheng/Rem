import { corruptRuntimeRow } from './runtime-sqlite-error.js';
import { requireArray, requirePlainObject, runtimeEnum, runtimeFiniteNumber, runtimeText } from './runtime-row-validation.js';

type RecordValue = Record<string, unknown>;
type BlockType = 'text' | 'image' | 'thinking' | 'toolCall';

const fail = (column: string, expectation: string, value: unknown): never =>
  corruptRuntimeRow(`Invalid ${column}`, new TypeError(`${column} must be ${expectation}; received ${String(value)}`));

function optionalText(value: RecordValue, property: string, column: string): void {
  if (Object.hasOwn(value, property)) runtimeText(value[property], `${column}.${property}`, true);
}

function validateUsage(value: unknown, column: string): void {
  requirePlainObject(value, column);
  for (const property of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) {
    runtimeFiniteNumber(value[property], `${column}.${property}`);
  }
  for (const property of ['cacheWrite1h', 'reasoning']) {
    if (Object.hasOwn(value, property)) runtimeFiniteNumber(value[property], `${column}.${property}`);
  }
  requirePlainObject(value.cost, `${column}.cost`);
  for (const property of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) {
    runtimeFiniteNumber(value.cost[property], `${column}.cost.${property}`);
  }
}

function validateBlock(value: unknown, column: string, allowed: readonly BlockType[]): void {
  requirePlainObject(value, column);
  const type = runtimeEnum(value.type, `${column}.type`, allowed);
  if (type === 'text') {
    runtimeText(value.text, `${column}.text`, true); optionalText(value, 'textSignature', column); return;
  }
  if (type === 'image') {
    runtimeText(value.data, `${column}.data`, true); runtimeText(value.mimeType, `${column}.mimeType`, true); return;
  }
  if (type === 'thinking') {
    runtimeText(value.thinking, `${column}.thinking`, true); optionalText(value, 'thinkingSignature', column);
    if (Object.hasOwn(value, 'redacted') && typeof value.redacted !== 'boolean') fail(`${column}.redacted`, 'a boolean', value.redacted);
    return;
  }
  runtimeText(value.id, `${column}.id`); runtimeText(value.name, `${column}.name`);
  requirePlainObject(value.arguments, `${column}.arguments`); optionalText(value, 'thoughtSignature', column);
}

function validateBlocks(value: unknown, column: string, allowed: readonly BlockType[]): void {
  requireArray(value, column);
  value.forEach((block, index) => validateBlock(block, `${column}[${index}]`, allowed));
}

function validateUser(value: RecordValue, column: string): void {
  if (typeof value.content !== 'string') validateBlocks(value.content, `${column}.content`, ['text', 'image']);
}

function validateAssistant(value: RecordValue, column: string): void {
  validateBlocks(value.content, `${column}.content`, ['text', 'thinking', 'toolCall']);
  runtimeText(value.api, `${column}.api`); runtimeText(value.provider, `${column}.provider`); runtimeText(value.model, `${column}.model`);
  for (const property of ['responseModel', 'responseId', 'errorMessage']) optionalText(value, property, column);
  if (Object.hasOwn(value, 'diagnostics')) requireArray(value.diagnostics, `${column}.diagnostics`);
  validateUsage(value.usage, `${column}.usage`);
  runtimeEnum(value.stopReason, `${column}.stopReason`, ['stop', 'length', 'toolUse', 'error', 'aborted'] as const);
}

function validateToolResult(value: RecordValue, column: string): void {
  runtimeText(value.toolCallId, `${column}.toolCallId`); runtimeText(value.toolName, `${column}.toolName`);
  validateBlocks(value.content, `${column}.content`, ['text', 'image']);
  if (typeof value.isError !== 'boolean') fail(`${column}.isError`, 'a boolean', value.isError);
  if (Object.hasOwn(value, 'usage')) validateUsage(value.usage, `${column}.usage`);
  if (Object.hasOwn(value, 'addedToolNames')) {
    requireArray(value.addedToolNames, `${column}.addedToolNames`);
    value.addedToolNames.forEach((name, index) => runtimeText(name, `${column}.addedToolNames[${index}]`, true));
  }
}

export function validateMessage(value: unknown, column: string): void {
  requirePlainObject(value, column);
  const role = runtimeEnum(value.role, `${column}.role`, ['user', 'assistant', 'toolResult'] as const);
  runtimeFiniteNumber(value.timestamp, `${column}.timestamp`);
  if (role === 'user') validateUser(value, column);
  else if (role === 'assistant') validateAssistant(value, column);
  else validateToolResult(value, column);
}
