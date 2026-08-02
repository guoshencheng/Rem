import { describe, expect, it } from 'vitest';
import { LiveAgentTestToolProvider } from '../src/testing/live-agent/test-tool-provider.js';

const context = { cwd: '/', workspaceRoot: '/', sessionId: 'live-1' };

describe('LiveAgentTestToolProvider', () => {
  it('只提供内存测试工具并按调用顺序记录', async () => {
    const provider = new LiveAgentTestToolProvider({ answer: 42 });

    expect(provider.getToolSet().map((tool) => tool.name)).toEqual(['get_test_data', 'record_result']);

    const [dataResult] = await provider.execute([
      { toolCallId: 'call-1', toolName: 'get_test_data', input: {} },
    ], context);
    const [recordResult] = await provider.execute([
      { toolCallId: 'call-2', toolName: 'record_result', input: { answer: 42 } },
    ], context);

    expect(dataResult.output).toBe('{"answer":42}');
    expect(recordResult.output).toBe('result recorded');
    expect(provider.calls).toEqual([
      { sequence: 1, toolName: 'get_test_data', input: {} },
      { sequence: 2, toolName: 'record_result', input: { answer: 42 } },
    ]);
  });

  it('按 key 返回顶层测试数据', async () => {
    const provider = new LiveAgentTestToolProvider({ orders: { 'A-100': { status: 'paid' } } });
    const [result] = await provider.execute([
      { toolCallId: 'call-1', toolName: 'get_test_data', input: { key: 'orders' } },
    ], context);

    expect(result.output).toBe('{"A-100":{"status":"paid"}}');
  });
});
