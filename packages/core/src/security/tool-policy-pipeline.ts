import type { ToolDefinition } from '../sdk/tool-provider.js';
import type { ToolPolicyConfig } from '../sdk/tool-policy.js';
import { expandToolGroups, normalizeToolName } from './tool-policy-shared.js';
import { resolveProfilePolicy } from './tool-policy-profile.js';

export { normalizeToolName };

export interface ToolPolicyPipelineParams {
  tools: ToolDefinition[];
  readOnly: boolean;
  policy: ToolPolicyConfig;
  provider?: string;
  sender?: string;
}

export function applyToolPolicyPipeline(params: ToolPolicyPipelineParams): ToolDefinition[] {
  let filtered = params.readOnly
    ? params.tools.filter((tool) => tool.readOnly === true)
    : params.tools;

  if (params.policy.profile) {
    filtered = applyLayer(filtered, resolveProfilePolicy(params.policy.profile));
  }

  filtered = applyLayer(filtered, params.policy);

  if (params.provider && params.policy.byProvider?.[params.provider]) {
    filtered = applyLayer(filtered, params.policy.byProvider[params.provider]);
  }

  if (params.sender && params.policy.toolsBySender?.[params.sender]) {
    filtered = applyLayer(filtered, params.policy.toolsBySender[params.sender]);
  }

  if (params.policy.sandbox?.tools) {
    filtered = applyLayer(filtered, params.policy.sandbox.tools);
  }

  return filtered;
}

function applyLayer(tools: ToolDefinition[], layer: ToolPolicyConfig): ToolDefinition[] {
  const denySet = new Set(expandToolGroups(layer.deny ?? []));
  let result = tools.filter((tool) => !denySet.has(normalizeToolName(tool.name)));

  const allow = layer.allow ?? layer.alsoAllow;
  if (allow) {
    if (allow.length === 0) {
      return [];
    }
    const allowSet = new Set(expandToolGroups([...layer.allow ?? [], ...(layer.alsoAllow ?? [])]));
    result = result.filter((tool) => {
      const name = normalizeToolName(tool.name);
      return allowSet.has(name) || allowSet.has('*');
    });
  }

  return result;
}
