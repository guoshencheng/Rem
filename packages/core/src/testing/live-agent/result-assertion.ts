import { isDeepStrictEqual } from 'node:util';
import type { LiveAgentResultAssertion, LiveAgentToolCall } from './types.js';

export function assertLiveAgentResult(
  calls: LiveAgentToolCall[],
  expectedResult: Record<string, unknown> | undefined,
): LiveAgentResultAssertion {
  if (!expectedResult) return { passed: true };

  const recorded = [...calls].reverse().find((call) => call.toolName === 'record_result');
  if (!recorded) return { passed: false, reason: 'Agent 未调用 record_result' };
  if (!isDeepStrictEqual(recorded.input, expectedResult)) {
    return {
      passed: false,
      reason: `record_result 参数不匹配：期望 ${JSON.stringify(expectedResult)}，实际 ${JSON.stringify(recorded.input)}`,
    };
  }
  return { passed: true };
}
