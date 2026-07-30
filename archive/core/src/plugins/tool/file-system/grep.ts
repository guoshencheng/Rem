import { Type, type Static } from '@sinclair/typebox';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { resolveWorkspacePath } from '../../../security/workspace-root-guard.js';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { Rule } from '../../../security/rules/rule.js';
import { executeGlob } from './shared/glob-executor.js';
import { truncateLine } from './shared/truncate.js';

const grepSchema = Type.Object(
  {
    pattern: Type.String({ description: 'Regex pattern to search for (or literal if literal=true)' }),
    path: Type.Optional(Type.String({ description: 'File or directory to search (default: cwd)' })),
    glob: Type.Optional(Type.String({ description: 'Glob filter for files under path' })),
    literal: Type.Optional(Type.Boolean({ description: 'Treat pattern as literal text', default: false })),
    ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive search', default: false })),
    context: Type.Optional(Type.Number({ description: 'Number of context lines around each match', default: 0 })),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of matches to return', default: 100 })),
  },
  { additionalProperties: false },
);

export type GrepToolInput = Static<typeof grepSchema>;

const DEFAULT_LIMIT = 100;

interface GrepMatch {
  relativePath: string;
  lineNumber: number;
  text: string;
  isMatch: boolean;
}

export function createGrepToolDefinition(): ToolDefinition<typeof grepSchema> {
  return {
    name: 'grep',
    description: 'Search file contents for a regex or literal pattern.',
    parameters: grepSchema,
    category: 'search',
    readOnly: true,
  };
}

export function createGrepToolExecutor(): ToolExecutor<typeof grepSchema> {
  return async (input: GrepToolInput, ctx: ToolContext) => {
    const searchPath = resolveWorkspacePath(input.path ?? '.', ctx);
    const filePaths = await resolveFilePaths(searchPath, input.glob, ctx);

    const regex = buildRegex(input.pattern, { literal: input.literal, ignoreCase: input.ignoreCase });
    const contextLines = Math.max(0, Math.floor(input.context ?? 0));
    const limit = Number.isFinite(input.limit) && input.limit != null ? Math.max(1, input.limit) : DEFAULT_LIMIT;

    const allMatches: GrepMatch[] = [];
    let totalMatches = 0;

    for (const filePath of filePaths) {
      if (totalMatches >= limit) break;
      const fileMatches = await grepFile(filePath, ctx.workspaceRoot, regex, contextLines, limit - totalMatches);
      allMatches.push(...fileMatches);
      totalMatches += fileMatches.filter((m) => m.isMatch).length;
    }

    if (allMatches.length === 0) {
      return { output: '(no matches)' };
    }

    const output = formatMatches(allMatches);
    const truncated = totalMatches >= limit ? `\n\n[${limit} matches limit reached]` : '';
    return { output: output + truncated };
  };
}

async function resolveFilePaths(
  searchPath: string,
  globFilter: string | undefined,
  ctx: ToolContext,
): Promise<string[]> {
  const pathStat = await stat(searchPath).catch(() => null);
  if (pathStat?.isFile()) {
    return [searchPath];
  }

  const relativePaths = await executeGlob(
    { pattern: globFilter ?? '**/*', path: searchPath, limit: 10000 },
    { cwd: ctx.cwd, workspaceRoot: ctx.workspaceRoot },
  );
  return relativePaths.map((p) => resolve(ctx.workspaceRoot, p));
}

function buildRegex(
  pattern: string,
  options: { literal?: boolean; ignoreCase?: boolean },
): RegExp {
  if (options.literal) {
    return new RegExp(escapeRegExp(pattern), options.ignoreCase ? 'i' : '');
  }
  return new RegExp(pattern, options.ignoreCase ? 'i' : undefined);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function grepFile(
  absolutePath: string,
  workspaceRoot: string,
  regex: RegExp,
  contextLines: number,
  remainingLimit: number,
): Promise<GrepMatch[]> {
  const relativePath = relative(workspaceRoot, absolutePath);
  const lines: { text: string; lineNumber: number }[] = [];
  const stream = createReadStream(absolutePath, 'utf8');
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lines.push({ text: line, lineNumber: lines.length + 1 });
  }

  const result: GrepMatch[] = [];
  const addedContext = new Set<number>();
  let matchCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (matchCount >= remainingLimit) break;
    const line = lines[i];
    if (!line) continue;

    if (regex.test(line.text)) {
      for (let j = Math.max(0, i - contextLines); j < i; j++) {
        if (!addedContext.has(j)) {
          result.push({ relativePath, lineNumber: lines[j].lineNumber, text: lines[j].text, isMatch: false });
          addedContext.add(j);
        }
      }

      result.push({ relativePath, lineNumber: line.lineNumber, text: line.text, isMatch: true });
      addedContext.add(i);
      matchCount++;

      for (let j = i + 1; j <= Math.min(lines.length - 1, i + contextLines); j++) {
        if (!addedContext.has(j)) {
          result.push({ relativePath, lineNumber: lines[j].lineNumber, text: lines[j].text, isMatch: false });
          addedContext.add(j);
        }
      }
    }
  }

  return result;
}

function formatMatches(matches: GrepMatch[]): string {
  return matches
    .map((m) => {
      const { text } = truncateLine(m.text);
      if (m.isMatch) {
        return `${m.relativePath}:${m.lineNumber}: ${text}`;
      }
      return `${m.relativePath}-${m.lineNumber}-: ${text}`;
    })
    .join('\n');
}

export function deriveGrepPatterns(input: { path?: string; glob?: string }): string[] {
  return [`file:${input.path ?? ''}`, `glob:${input.glob ?? ''}`];
}

export function deriveGrepAlwaysOptions(input: { path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.path ?? '';
  return [
    { label: p, rule: { permission: 'grep', pattern: p, action: 'allow' } },
    { label: 'all', rule: { permission: 'grep', pattern: '*', action: 'allow' } },
  ];
}
