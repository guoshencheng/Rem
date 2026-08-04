import { describe, expect, it } from 'vitest';
import { parseLiveAgentCommandOptions } from '../src/testing/live-agent/command-options.js';

describe('live agent 命令选项', () => {
  it('只解析任务与 pnpm 转发分隔符', () => {
    expect(parseLiveAgentCommandOptions(['--', '--task', '你好'])).toEqual({ task: '你好' });
  });

  it('拒绝已删除的 fixture 与断言选项', () => {
    expect(() => parseLiveAgentCommandOptions(['--task', '你好', '--data', '{}'])).toThrow();
    expect(() => parseLiveAgentCommandOptions(['--task', '你好', '--expect-result', '{}'])).toThrow();
    expect(() => parseLiveAgentCommandOptions(['--task', '你好', '--keep-output'])).toThrow();
  });

  it('拒绝空任务', () => {
    expect(() => parseLiveAgentCommandOptions(['--task', '   '])).toThrow('--task');
  });
});
