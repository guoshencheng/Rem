import type { Rule, RuleSource } from './rule.js';

const SOURCE_PRIORITY: Record<RuleSource, number> = {
  session: 0,
  'user-config': 1,
  approved: 2,
  profile: 3,
  default: 4,
};

export function buildRuleSet(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source ?? 'default'];
    const pb = SOURCE_PRIORITY[b.source ?? 'default'];
    return pb - pa; // descending: lower priority number (higher priority) comes LAST
  });
}
