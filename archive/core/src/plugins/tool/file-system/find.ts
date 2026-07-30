import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { Rule } from '../../../security/rules/rule.js';
import { executeGlob } from './shared/glob-executor.js';

const findSchema = Type.Object(
  {
    pattern: Type.String({ description: 'Glob pattern for matching files' }),
    path: Type.Optional(Type.String({ description: 'Directory or file to search (default: cwd)' })),
    exclude: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description: 'Glob patterns to exclude',
      }),
    ),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of results to return' })),
  },
  { additionalProperties: false },
);

export type FindToolInput = Static<typeof findSchema>;

export function createFindToolDefinition(): ToolDefinition<typeof findSchema> {
  return {
    name: 'find',
    description: 'Recursively find files matching a glob pattern within the workspace.',
    parameters: findSchema,
    category: 'filesystem',
    readOnly: true,
  };
}

export function createFindToolExecutor(): ToolExecutor<typeof findSchema> {
  return async (input: FindToolInput, ctx: ToolContext) => {
    const matches = await executeGlob(
      { pattern: input.pattern, path: input.path, exclude: input.exclude, limit: input.limit },
      ctx,
    );

    if (matches.length === 0) {
      return { output: '(no matches)' };
    }

    let output = matches.join('\n');
    if (input.limit != null && matches.length >= input.limit) {
      output += `\n\n[${input.limit} entries limit reached]`;
    }
    return { output };
  };
}

export function deriveFindPatterns(input: { path?: string }): string[] {
  return [`file:${input.path ?? ''}`];
}

export function deriveFindAlwaysOptions(input: { path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.path ?? '';
  return [
    { label: p, rule: { permission: 'find', pattern: p, action: 'allow' } },
    { label: 'all', rule: { permission: 'find', pattern: '*', action: 'allow' } },
  ];
}
