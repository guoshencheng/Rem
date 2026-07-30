import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { Rule } from '../../../security/rules/rule.js';
import { executeGlob } from './shared/glob-executor.js';

const globSchema = Type.Object(
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

export type GlobToolInput = Static<typeof globSchema>;

export function createGlobToolDefinition(): ToolDefinition<typeof globSchema> {
  return {
    name: 'glob',
    description: 'Find files matching a glob pattern within the workspace.',
    parameters: globSchema,
    category: 'filesystem',
    readOnly: true,
  };
}

export function createGlobToolExecutor(): ToolExecutor<typeof globSchema> {
  return async (input: GlobToolInput, ctx: ToolContext) => {
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

export function deriveGlobPatterns(input: { path?: string }): string[] {
  return [`file:${input.path ?? ''}`];
}

export function deriveGlobAlwaysOptions(input: { path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.path ?? '';
  return [
    { label: p, rule: { permission: 'glob', pattern: p, action: 'allow' } },
    { label: 'all', rule: { permission: 'glob', pattern: '*', action: 'allow' } },
  ];
}
