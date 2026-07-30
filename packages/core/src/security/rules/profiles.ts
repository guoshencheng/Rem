import type { Rule, RuleAction } from './rule.js';

export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

function rule(permission: string, pattern: string, action: RuleAction): Rule {
  return { permission, pattern, action, source: 'profile' };
}

const PROFILES: Record<ToolProfileId, Rule[]> = {
  minimal: [
    rule('session_status', '*', 'allow'),
  ],
  coding: [
    rule('read', '*', 'allow'),
    rule('ls', '*', 'allow'),
    rule('glob', '*', 'allow'),
    rule('find', '*', 'allow'),
    rule('grep', '*', 'allow'),
    rule('exec', 'git *', 'allow'),
    rule('exec', 'ls *', 'allow'),
    rule('exec', 'cat *', 'allow'),
    rule('exec', 'grep *', 'allow'),
    rule('exec', 'find *', 'allow'),
    rule('exec', 'pwd', 'allow'),
    rule('exec', 'echo *', 'allow'),
    rule('apply_patch', '*', 'ask'),
    // write/edit default ask via default rules
  ],
  messaging: [
    rule('session_status', '*', 'allow'),
  ],
  full: [],
};

export function getProfileRules(profile: ToolProfileId): Rule[] {
  return PROFILES[profile] ?? [];
}
