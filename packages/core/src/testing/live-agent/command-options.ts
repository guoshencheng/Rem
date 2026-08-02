import { parseArgs } from 'node:util';
import type { LiveAgentCommandOptions } from './types.js';

const DEFAULT_TEST_DATA = { orders: { 'A-100': { status: 'paid' } } };

export function parseLiveAgentCommandOptions(argv: string[]): LiveAgentCommandOptions {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: {
      task: { type: 'string' },
      data: { type: 'string' },
      'expect-result': { type: 'string' },
      'keep-output': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const task = values.task?.trim();
  if (!task) throw new Error('--task 必须是非空文本');

  const data = values.data === undefined ? DEFAULT_TEST_DATA : parseJson(values.data, '--data');
  const expectedResult = values['expect-result'] === undefined
    ? undefined
    : parseObjectJson(values['expect-result'], '--expect-result');

  return { task, data, expectedResult, keepOutput: values['keep-output'] === true };
}

function parseObjectJson(value: string, optionName: string): Record<string, unknown> {
  const parsed = parseJson(value, optionName);
  if (!isRecord(parsed)) throw new Error(`${optionName} 必须是 JSON 对象`);
  return parsed;
}

function parseJson(value: string, optionName: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${optionName} 必须是有效 JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
