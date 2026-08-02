import { describe, expect, it } from 'vitest';
import { parseLiveAgentCommandOptions } from '../src/testing/live-agent/command-options.js';

describe('live agent 命令选项', () => {
  it('解析任务、fixture、预期结果和完整事件开关', () => {
    expect(parseLiveAgentCommandOptions([
      '--task', '查询订单 A-100',
      '--data', '{"orders":{"A-100":{"status":"paid"}}}',
      '--expect-result', '{"orderId":"A-100","status":"paid"}',
      '--keep-output',
    ])).toEqual({
      task: '查询订单 A-100',
      data: { orders: { 'A-100': { status: 'paid' } } },
      expectedResult: { orderId: 'A-100', status: 'paid' },
      keepOutput: true,
    });
  });

  it.each([
    [['--task', 'x', '--data', '{bad'], '--data'],
    [['--task', 'x', '--expect-result', '[]'], '--expect-result'],
    [['--task', '   '], '--task'],
  ])('报告无效参数 %j', (argv, parameter) => {
    expect(() => parseLiveAgentCommandOptions(argv)).toThrow(parameter);
  });
});
