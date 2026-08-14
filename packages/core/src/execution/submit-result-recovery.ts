import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { ToolInvocation } from '../domain/run/types.js';
import { validateJsonSchema } from '../application/runs/json-schema-validation.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

export function restoreSubmittedResult(definition: AgentDefinition, invocations: readonly ToolInvocation[]): unknown {
  if (definition.outputSchema === undefined) return undefined;
  const submissions = invocations
    .filter((invocation) => invocation.toolName === 'submit_result' && invocation.status === 'succeeded')
    .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime());
  const latest = submissions.at(-1);
  if (!latest) return undefined;
  try {
    const result = latest.result;
    if (typeof result !== 'object' || result === null || Array.isArray(result) || typeof (result as { output?: unknown }).output !== 'string') {
      throw new Error('Persisted submit_result output is invalid');
    }
    const parsed = JSON.parse((result as { output: string }).output);
    return cloneCanonicalJson(validateJsonSchema(definition.outputSchema, parsed, 'result'));
  } catch (cause) {
    throw new RuntimeError('INTERNAL_ERROR', 'Persisted structured result is invalid', false, undefined, { cause });
  }
}
