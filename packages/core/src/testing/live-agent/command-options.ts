import { parseArgs } from 'node:util';
import type { LiveAgentCommandOptions } from './types.js';

export function parseLiveAgentCommandOptions(argv: string[]): LiveAgentCommandOptions {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: {
      task: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const task = values.task?.trim();
  if (!task) throw new Error('--task 必须是非空文本');

  return { task };
}
