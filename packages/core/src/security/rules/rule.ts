import { Type, type Static } from '@sinclair/typebox';

export const RuleActionSchema = Type.Union([
  Type.Literal('allow'),
  Type.Literal('deny'),
  Type.Literal('ask'),
]);
export type RuleAction = Static<typeof RuleActionSchema>;

export const RuleSourceSchema = Type.Union([
  Type.Literal('default'),
  Type.Literal('profile'),
  Type.Literal('user-config'),
  Type.Literal('approved'),
  Type.Literal('session'),
]);
export type RuleSource = Static<typeof RuleSourceSchema>;

export const RuleSchema = Type.Object({
  permission: Type.String({ minLength: 1 }),
  pattern: Type.String({ minLength: 1 }),
  action: RuleActionSchema,
  source: Type.Optional(RuleSourceSchema),
  outside: Type.Optional(Type.Boolean()),
});
export type Rule = Static<typeof RuleSchema>;

export function isRuleAction(value: unknown): value is RuleAction {
  return value === 'allow' || value === 'deny' || value === 'ask';
}
