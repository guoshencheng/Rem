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
  const hasAllow = layer.allow !== undefined;
  const hasAlsoAllow = layer.alsoAllow !== undefined;

  if (hasAllow || hasAlsoAllow) {
    const allowSet = new Set(expandToolGroups(layer.allow ?? []));
    const alsoAllowSet = new Set(expandToolGroups(layer.alsoAllow ?? []));
    const combined = new Set([...allowSet, ...alsoAllowSet]);

    tools = tools.filter((tool) => {
      const name = normalizeToolName(tool.name);
      return combined.has(name) || combined.has('*');
    });
  }

  if (layer.deny && layer.deny.length > 0) {
    const denySet = new Set(expandToolGroups(layer.deny));
    tools = tools.filter((tool) => !denySet.has(normalizeToolName(tool.name)));
  }

  return tools;
}
