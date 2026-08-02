import { describe, expect, it } from 'vitest';
import { assertLiveAgentResult } from '../src/testing/live-agent/result-assertion.js';

describe('live agent 结果断言', () => {
  it('没有预期结果时仍要求记录结果', () => {
    expect(assertLiveAgentResult([
      { sequence: 1, toolName: 'record_result', input: { status: 'paid' } },
    ], undefined)).toEqual({ passed: true });
  });

  it('要求最后一次 record_result 与预期对象深度相等', () => {
    expect(assertLiveAgentResult([
      { sequence: 1, toolName: 'record_result', input: { status: 'draft' } },
      { sequence: 2, toolName: 'record_result', input: { status: 'paid' } },
    ], { status: 'paid' })).toEqual({ passed: true });
  });

  it('未记录结果或结果不匹配时失败', () => {
    expect(assertLiveAgentResult([], undefined)).toMatchObject({ passed: false });
    expect(assertLiveAgentResult([], { status: 'paid' })).toMatchObject({ passed: false });
    expect(assertLiveAgentResult([
      { sequence: 1, toolName: 'record_result', input: { status: 'draft' } },
    ], { status: 'paid' })).toMatchObject({ passed: false });
  });
});
