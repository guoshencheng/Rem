export interface LiveAgentCommandOptions {
  task: string;
  data: unknown;
  expectedResult?: Record<string, unknown>;
  keepOutput: boolean;
}

export interface LiveAgentToolCall {
  sequence: number;
  toolName: 'get_test_data' | 'record_result';
  input: unknown;
}

export interface LiveAgentResultAssertion {
  passed: boolean;
  reason?: string;
}
