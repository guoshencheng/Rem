import { describe, expect, it } from 'vitest';
import { fauxAssistantMessage } from './helpers/scripted-models.js';
import { createTestAgent } from './helpers/test-agent.js';

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe('Agent 内置工具能力', () => {
  it('缺省仍提供 read_skill、delegate_task 与 todowrite', async () => {
    const seen: string[][] = [];
    const { agent } = await createTestAgent({
      steps: [({ context }) => {
        seen.push(context.tools?.map((tool) => tool.name).sort() ?? []);
        return fauxAssistantMessage('done');
      }],
    });

    await collect(agent.run({ content: 'hello' }));

    expect(seen[0]).toEqual(expect.arrayContaining(['read_skill', 'delegate_task', 'todowrite']));
  });

  it('关闭全部内置工具时仅暴露调用方注入的工具', async () => {
    const seen: string[][] = [];
    const { agent } = await createTestAgent({
      tools: [{ name: 'get_test_data', run: async () => '{}' }],
      toolCapabilities: { readSkill: false, delegateTask: false, todoWrite: false },
      steps: [({ context }) => {
        seen.push(context.tools?.map((tool) => tool.name) ?? []);
        return fauxAssistantMessage('done');
      }],
    });

    await collect(agent.run({ content: 'hello' }));

    expect(seen).toEqual([['get_test_data']]);
  });

  it('关闭全部内置工具且未注入工具时暴露空工具集', async () => {
    const seen: string[][] = [];
    const { agent } = await createTestAgent({
      toolCapabilities: { readSkill: false, delegateTask: false, todoWrite: false },
      steps: [({ context }) => {
        seen.push(context.tools?.map((tool) => tool.name) ?? []);
        return fauxAssistantMessage('done');
      }],
    });

    await collect(agent.run({ content: 'hello' }));

    expect(seen).toEqual([[]]);
  });
});
