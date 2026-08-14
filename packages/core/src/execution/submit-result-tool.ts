import { Type } from '@sinclair/typebox';
import type { AgentDefinition } from '../domain/agent-definition/types.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';
import { validateJsonSchema } from '../application/runs/json-schema-validation.js';
import type { CustomTool } from '../plugins/tool/static/index.js';

export function createSubmitResultTool(
  definition: AgentDefinition,
  onSubmitted: (result: unknown) => void,
  canSubmit?: () => boolean | Promise<boolean>,
): CustomTool {
  if (definition.outputSchema === undefined) throw new Error('submit_result requires outputSchema');
  return {
    definition: {
      name: 'submit_result',
      description: 'Submit the structured result for this task. The result must match the task output schema.',
      parameters: Type.Object({ result: Type.Any() }),
      sideEffect: 'none', readOnly: true,
    },
    executor: async (input) => {
      try {
        if (canSubmit !== undefined && !(await canSubmit())) {
          return { output: '', error: 'Cannot submit a final result while Team deliveries are pending' };
        }
        const value = validateJsonSchema(definition.outputSchema!, (input as { result?: unknown }).result, 'result');
        const isolated = cloneCanonicalJson(value);
        onSubmitted(isolated);
        return { output: JSON.stringify(isolated) };
      } catch (error) {
        return { output: '', error: error instanceof Error ? 'Result does not match the output schema' : 'Invalid result' };
      }
    },
  };
}
