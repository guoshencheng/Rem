import type { ApprovalRequestInput, ToolPermissionEvaluator } from './types.js';
import type { RuleEngine } from '../rules/rule-engine.js';
import { BaseRuleEvaluator } from './base-evaluator.js';
import { AutoPermissionEvaluator } from './auto-evaluator.js';
import { InteractivePermissionEvaluator } from './interactive-evaluator.js';

export type SecurityMode = 'auto' | 'interactive';

export interface ApprovalRequestFactory {
  create(input: ApprovalRequestInput): ApprovalRequestInput;
}

export function createPermissionEvaluator(
  mode: SecurityMode,
  ruleEngine: RuleEngine,
  approvalFactory?: ApprovalRequestFactory,
): ToolPermissionEvaluator {
  const base = new BaseRuleEvaluator(ruleEngine);
  if (mode === 'auto') {
    return new AutoPermissionEvaluator(base);
  }
  if (!approvalFactory) {
    throw new Error('interactive mode requires an approvalFactory');
  }
  return new InteractivePermissionEvaluator(base, approvalFactory);
}
