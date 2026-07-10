import type { ToolCall, ToolDefinition } from '../../sdk/tool-provider.js';
import type { PermissionDecision, ToolPermissionEvaluator } from './types.js';
import { BaseRuleEvaluator } from './base-evaluator.js';
import { classifyTool } from './tool-classifier.js';

export class AutoPermissionEvaluator implements ToolPermissionEvaluator {
  constructor(private base: BaseRuleEvaluator) {}

  async evaluate(toolCall: ToolCall, toolDef: ToolDefinition): Promise<PermissionDecision> {
    const derivedPatterns = derivePatterns(toolCall, toolDef);
    const category = classifyTool(toolCall.toolName, toolDef, derivedPatterns);
    const ruleAction = this.base.evaluateRules(toolCall.toolName, derivedPatterns);

    if (ruleAction === 'deny') {
      return { action: 'deny', reason: 'denied by rule' };
    }
    if (ruleAction === 'allow') {
      return { action: 'allow' };
    }

    if (category === 'sensitive-read') {
      return { action: 'deny', reason: 'sensitive read blocked in auto mode' };
    }

    return { action: 'allow' };
  }
}

function derivePatterns(toolCall: ToolCall, toolDef: ToolDefinition): string[] {
  if (toolDef.derivePatterns) {
    return toolDef.derivePatterns(toolCall.input as never);
  }
  return [`tool:${toolCall.toolName}`];
}
