import type { ToolCall, ToolDefinition } from '../../sdk/tool-provider.js';
import type { PermissionDecision, ApprovalRequestInput, ToolPermissionEvaluator } from './types.js';
import type { Rule } from '../rules/rule.js';
import { BaseRuleEvaluator } from './base-evaluator.js';
import { classifyTool } from './tool-classifier.js';

export interface ApprovalRequestFactory {
  create(input: ApprovalRequestInput): ApprovalRequestInput;
}

export class InteractivePermissionEvaluator implements ToolPermissionEvaluator {
  constructor(
    private base: BaseRuleEvaluator,
    private approvalFactory: ApprovalRequestFactory,
  ) {}

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

    if (category === 'read') {
      return { action: 'allow' };
    }

    return {
      action: 'ask',
      request: this.approvalFactory.create({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        patterns: derivedPatterns,
        title: `Run ${toolCall.toolName}`,
        description: JSON.stringify(toolCall.input).slice(0, 200),
        severity: 'warning',
        alwaysOptions: deriveAlwaysOptions(toolCall, toolDef),
      }),
    };
  }
}

function derivePatterns(toolCall: ToolCall, toolDef: ToolDefinition): string[] {
  if (toolDef.derivePatterns) {
    return toolDef.derivePatterns(toolCall.input as never);
  }
  return [`tool:${toolCall.toolName}`];
}

function deriveAlwaysOptions(
  toolCall: ToolCall,
  toolDef: ToolDefinition,
): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  if (toolDef.deriveAlwaysOptions) {
    return toolDef.deriveAlwaysOptions(toolCall.input as never);
  }
  return [
    {
      label: toolCall.toolName,
      rule: { permission: toolCall.toolName, pattern: '*', action: 'allow' },
    },
  ];
}
