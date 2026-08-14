import type { ToolCall, ToolResult } from '../sdk/tool-provider.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';

export function normalizeRecordedToolResult(call: ToolCall, result: ToolResult): { persisted: unknown; returned: ToolResult } {
  const isolated = cloneCanonicalJson(result, { omitUndefinedProperties: true });
  if (typeof isolated !== 'object' || isolated === null || Array.isArray(isolated)) {
    throw new Error('Tool result must be a plain object');
  }
  const value = isolated as Record<string, unknown>;
  if (value.toolCallId !== call.toolCallId || value.toolName !== call.toolName || typeof value.output !== 'string'
    || value.error !== undefined && typeof value.error !== 'string') {
    throw new Error('Tool result identity or output is invalid');
  }
  const output = value.output;
  const details = value.details;
  const persisted = cloneCanonicalJson({ output, ...(details === undefined ? {} : { details }) });
  const returned = cloneCanonicalJson({ toolCallId: call.toolCallId, toolName: call.toolName, output,
    ...(details === undefined ? {} : { details }) }) as ToolResult;
  return { persisted, returned };
}
