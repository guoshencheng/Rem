import { describe, expect, it } from 'vitest';
import { formatLiveAgentEvent } from '../src/testing/live-agent/event-output.js';

describe('live agent 事件输出', () => {
  it('将工具执行与终态事件压缩成可读行', () => {
    const started = { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'get_test_data', args: {} } as const;
    const finished = { type: 'finish', output: { content: '订单已支付', completed: true } } as const;

    expect(formatLiveAgentEvent(started)).toContain('get_test_data');
    expect(formatLiveAgentEvent(finished)).toContain('完成');
    expect(formatLiveAgentEvent({ type: 'turn_start' } as never)).toBe('{"type":"turn_start"}');
  });
});
