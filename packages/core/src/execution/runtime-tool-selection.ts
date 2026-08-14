import type { RuntimeToolDefaults } from '../sdk/runtime-config-provider.js';
import type { RuntimeToolContribution } from '../sdk/runtime-plugin.js';
import { applyToolPolicyPipeline } from '../security/tool-policy/tool-policy-pipeline.js';

export function selectRuntimeTools(
  tools: readonly RuntimeToolContribution[],
  definitionToolNames: readonly string[],
  behavior: Pick<{ readOnly: boolean }, 'readOnly'>,
  tool: RuntimeToolDefaults,
  provider: string,
): RuntimeToolContribution[] {
  const definitionNames = new Set(definitionToolNames);
  const candidates = tools.filter((entry) => definitionNames.has(entry.definition.name));
  const allowed = new Set(applyToolPolicyPipeline({
    tools: candidates.map((entry) => entry.definition),
    readOnly: behavior.readOnly,
    policy: tool.policy ?? {},
    provider,
  }).map((definition) => definition.name));
  return candidates.filter((entry) => allowed.has(entry.definition.name));
}
