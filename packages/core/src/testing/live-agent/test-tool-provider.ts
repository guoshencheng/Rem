import { Type } from '@sinclair/typebox';
import { StaticToolProvider } from '../../plugins/tool/static/index.js';
import type { LiveAgentToolCall } from './types.js';

const getTestDataDefinition = {
  name: 'get_test_data',
  description: 'Return the in-memory test fixture. Call this before deciding the result.',
  parameters: Type.Object({ key: Type.Optional(Type.String()) }, { additionalProperties: false }),
};

const recordResultDefinition = {
  name: 'record_result',
  description: 'Record the final structured result for this test task.',
  parameters: Type.Object({}, { additionalProperties: true }),
};

/** 仅在内存中返回 fixture 并记录 Agent 的可观测结果。 */
export class LiveAgentTestToolProvider extends StaticToolProvider {
  private readonly records: LiveAgentToolCall[] = [];

  constructor(private readonly data: unknown) {
    super();
    this.register(getTestDataDefinition, async (input) => {
      this.record('get_test_data', input);
      const key = (input as { key?: string }).key;
      return { output: JSON.stringify(key === undefined ? this.data : this.getTopLevelValue(key)) };
    });
    this.register(recordResultDefinition, async (input) => {
      this.record('record_result', input);
      return { output: 'result recorded' };
    });
  }

  get calls(): LiveAgentToolCall[] {
    return this.records.map((record) => ({ ...record }));
  }

  private getTopLevelValue(key: string): unknown {
    if (typeof this.data !== 'object' || this.data === null || Array.isArray(this.data)) return undefined;
    return (this.data as Record<string, unknown>)[key];
  }

  private record(toolName: LiveAgentToolCall['toolName'], input: unknown): void {
    this.records.push({ sequence: this.records.length + 1, toolName, input });
  }
}
