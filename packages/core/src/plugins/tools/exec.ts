import { Type, type Static } from '@sinclair/typebox';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../sdk/tool-provider.js';

const execFileAsync = promisify(execFile);

const execSchema = Type.Object(
  {
    command: Type.String({ description: 'Shell command to execute' }),
    timeoutSec: Type.Optional(Type.Number({ description: 'Maximum execution time in seconds' })),
    cwd: Type.Optional(Type.String({ description: 'Working directory for the command' })),
  },
  { additionalProperties: false },
);

export type ExecToolInput = Static<typeof execSchema>;

const DEFAULT_TIMEOUT_SEC = 60;
const MAX_OUTPUT_CHARS = 20_000;

function truncateOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return value.slice(0, MAX_OUTPUT_CHARS) + `\n\n[output truncated at ${MAX_OUTPUT_CHARS} characters]`;
}

export function createExecToolDefinition(): ToolDefinition<typeof execSchema> {
  return {
    name: 'exec',
    description: `Execute a shell command on the host.`,
    parameters: execSchema,
    category: 'shell',
  };
}

export function createExecToolExecutor(): ToolExecutor<typeof execSchema> {
  return async (input: ExecToolInput, ctx: ToolContext) => {
    const command = input.command.trim();
    if (!command) {
      throw new Error('Empty command');
    }

    const cwd = input.cwd ?? ctx.cwd;
    const timeoutMs = (input.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;

    const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
      cwd,
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
    });

    const combined = [String(stdout), String(stderr)].filter(Boolean).join('\n');
    return { output: truncateOutput(combined) };
  };
}
