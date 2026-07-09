import { buildRuleSet } from './ruleset.js';
import { evaluate } from './evaluator.js';
import type { Rule, RuleAction } from './rule.js';
import type { ToolCallPattern } from './evaluator.js';

export class RuleEngine {
  constructor(private rules: Rule[]) {}

  evaluate(toolCall: ToolCallPattern): RuleAction {
    const set = buildRuleSet(this.rules);
    return evaluate(toolCall, set);
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }
}
