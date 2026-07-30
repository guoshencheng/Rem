import { expandToolGroups } from './tool-policy-shared.js';
import type { ToolPolicyConfig } from '../sdk/tool-policy.js';

const PROFILE_TOOLS: Record<string, string[] | undefined> = {
  minimal: ['session_status'],
  coding: ['group:fs', 'group:runtime', 'group:web', 'group:memory', 'group:sessions'],
  messaging: ['group:messaging', 'session_status'],
  full: undefined,
};

export function resolveProfilePolicy(profile: string): Pick<ToolPolicyConfig, 'allow'> {
  const tools = PROFILE_TOOLS[profile];
  return tools ? { allow: expandToolGroups(tools) } : {};
}
