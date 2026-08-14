import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { ArtifactDraft } from '../domain/artifact/types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

export function buildSingleAgentArtifacts(
  definition: AgentDefinition,
  assistant: AssistantMessage | undefined,
  submitted: unknown,
  intermediate: boolean,
): ArtifactDraft[] {
  const text = assistant?.content.filter((part) => part.type === 'text').map((part) => part.text).join('') ?? '';
  if (definition.outputSchema !== undefined) {
    if (submitted === undefined) {
      if (!intermediate) throw new RuntimeError('MODEL_EXECUTION_FAILED', 'Model execution did not submit a valid structured result');
      return [];
    }
    return [{ type: 'result', mediaType: 'application/json', name: 'result.json', data: JSON.stringify(submitted) }];
  }
  if (text) return [{ type: 'result', mediaType: 'text/plain', name: 'result.txt', data: text }];
  return intermediate ? [] : [];
}
