export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

export interface ToolPolicyConfig {
  profile?: ToolProfileId;
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
  byProvider?: Record<string, ToolPolicyConfig>;
  toolsBySender?: Record<string, ToolPolicyConfig>;
  sandbox?: SandboxToolPolicyConfig;
}

export interface SandboxToolPolicyConfig {
  mode?: 'off' | 'non-main' | 'all';
  tools?: ToolPolicyConfig;
}

export type ToolPolicyLike = ToolPolicyConfig;
