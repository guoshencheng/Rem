import type { Rule, RuleAction } from './rule.js';
import { matchPattern } from './matcher.js';

export interface ToolCallPattern {
  toolName: string;
  input: unknown;
  derivedPatterns: string[];
}

export function evaluate(toolCall: ToolCallPattern, rules: Rule[], defaultAction: RuleAction = 'ask'): RuleAction {
  const matched = rules.findLast((rule) => {
    if (!matchPattern(toolCall.toolName, rule.permission)) return false;
    return toolCall.derivedPatterns.some((p) => matchPattern(p, rule.pattern));
  });
  return matched?.action ?? defaultAction;
}
