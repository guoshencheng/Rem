import type { ToolDefinition } from '../sdk/tool-provider.js';
import type { ToolPolicyLike } from '../sdk/tool-policy.js';

export interface ToolPolicyPipelineParams {
  tools: ToolDefinition[];
  readOnly: boolean;
  policy: ToolPolicyLike;
}

export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function applyToolPolicyPipeline(params: ToolPolicyPipelineParams): ToolDefinition[] {
  const names = new Set(params.tools.map((t) => normalizeToolName(t.name)));
  let allowed = params.tools;

  if (params.readOnly) {
    allowed = allowed.filter((t) => t.readOnly === true);
  }

  const { allow, deny } = params.policy;

  if (allow) {
    const normalizedAllow = new Set(allow.map(normalizeToolName));
    allowed = allowed.filter((t) => {
      const name = normalizeToolName(t.name);
      if (normalizedAllow.has(name)) return true;
      for (const pattern of normalizedAllow) {
        if (pattern === '*') return true;
      }
      return false;
    });
  }

  if (deny && deny.length > 0) {
    const normalizedDeny = new Set(deny.map(normalizeToolName));
    allowed = allowed.filter((t) => !normalizedDeny.has(normalizeToolName(t.name)));
  }

  return allowed.filter((t) => names.has(normalizeToolName(t.name)));
}
