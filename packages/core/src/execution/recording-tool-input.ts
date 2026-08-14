import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import type { ToolDefinition } from '../sdk/tool-provider.js';
import { TypeCompiler } from '@sinclair/typebox/compiler';

export function cloneToolInput<T>(value: T, message: string): T {
  try { return cloneCanonicalJson(value) as T; }
  catch (error) { throw new RuntimeError('INVALID_INPUT', message, false, undefined, { cause: error }); }
}

export function validateToolInput(definition: ToolDefinition, value: unknown): string | undefined {
  let check: ReturnType<typeof TypeCompiler.Compile>;
  try { check = TypeCompiler.Compile(definition.parameters); }
  catch { return `Invalid schema for tool "${safeText(definition.name)}"`; }
  if (check.Check(value)) return undefined;
  const message = Array.from(check.Errors(value)).map((error) => `${error.path}: ${error.message}`).join('; ');
  return `Invalid input for tool "${safeText(definition.name)}": ${message || 'invalid input'}`;
}

function safeText(value: string): string { return value.replace(/[\r\n\t]/g, ' ').slice(0, 200); }
