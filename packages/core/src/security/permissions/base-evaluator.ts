import type { RuleAction } from '../rules/rule.js';
import type { RuleEngine } from '../rules/rule-engine.js';

export class BaseRuleEvaluator {
  constructor(private ruleEngine: RuleEngine) {}

  evaluateRules(toolName: string, derivedPatterns: string[]): RuleAction {
    return this.ruleEngine.evaluate({ toolName, derivedPatterns });
  }
}
