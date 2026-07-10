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

  checkOutsideAllowed(toolName: string, derivedPatterns: string[]): boolean {
    const outsideRules = this.rules.filter((r) => r.outside === true);
    const set = buildRuleSet(outsideRules);
    const action = evaluate({ toolName, derivedPatterns }, set, 'deny');
    return action === 'allow';
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }
}
