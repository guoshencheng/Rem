# 真实 LLM Agent 纯观测入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `pnpm test:agent:live` 简化为只接收任务、输出完整事件流和最终结果的真实 LLM 观测命令。

**Architecture:** 保留真实 Core 装配和临时 SQLite storage，但用空 `StaticToolProvider` 取代内存 fixture 工具，并继续关闭全部内置工具。参数解析只产生 `{ task }`；运行协调器逐条输出事件，不再保存工具调用记录或执行内容断言。

**Tech Stack:** TypeScript（NodeNext）、Node.js `util.parseArgs`、Vitest、tsx、`@earendil-works/pi-ai` / `pi-agent-core`。

---

### Task 1: 删除自动化验证接口

**Files:**

- Modify: `packages/core/src/testing/live-agent/types.ts`
- Modify: `packages/core/src/testing/live-agent/command-options.ts`
- Modify: `packages/core/tests/live-agent-command-options.test.ts`
- Delete: `packages/core/src/testing/live-agent/test-tool-provider.ts`
- Delete: `packages/core/src/testing/live-agent/result-assertion.ts`
- Delete: `packages/core/tests/live-agent-test-tool-provider.test.ts`
- Delete: `packages/core/tests/live-agent-result-assertion.test.ts`

- [ ] **Step 1: 写出只接受任务的失败测试。**

```ts
it('只解析任务与 pnpm 转发分隔符', () => {
  expect(parseLiveAgentCommandOptions(['--', '--task', '你好'])).toEqual({ task: '你好' });
});

it('拒绝已删除的 fixture 与断言选项', () => {
  expect(() => parseLiveAgentCommandOptions(['--task', '你好', '--data', '{}'])).toThrow();
  expect(() => parseLiveAgentCommandOptions(['--task', '你好', '--expect-result', '{}'])).toThrow();
  expect(() => parseLiveAgentCommandOptions(['--task', '你好', '--keep-output'])).toThrow();
});
```

- [ ] **Step 2: 运行测试，确认旧参数仍被接受。**

Run: `pnpm exec vitest run packages/core/tests/live-agent-command-options.test.ts`

Expected: FAIL；旧实现返回 `data`、`expectedResult`、`keepOutput`，并接受三项旧选项。

- [ ] **Step 3: 最小化选项类型与解析器。**

```ts
export interface LiveAgentCommandOptions {
  task: string;
}

export function parseLiveAgentCommandOptions(argv: string[]): LiveAgentCommandOptions {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: { task: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  const task = values.task?.trim();
  if (!task) throw new Error('--task 必须是非空文本');
  return { task };
}
```

移除 `LiveAgentToolCall`、`LiveAgentResultAssertion`、默认 fixture 与 JSON 解析辅助函数。

- [ ] **Step 4: 删除无用模块与测试。**

Run:

```bash
rm packages/core/src/testing/live-agent/test-tool-provider.ts
rm packages/core/src/testing/live-agent/result-assertion.ts
rm packages/core/tests/live-agent-test-tool-provider.test.ts
rm packages/core/tests/live-agent-result-assertion.test.ts
```

- [ ] **Step 5: 验证纯参数行为。**

Run: `pnpm exec vitest run packages/core/tests/live-agent-command-options.test.ts && pnpm --filter rem-agent-core typecheck`

Expected: PASS；已删除参数报错，且没有孤立导入。

### Task 2: 用空工具集输出完整事件流

**Files:**

- Modify: `packages/core/src/testing/live-agent/run-live-agent.ts`
- Modify: `packages/core/src/testing/live-agent/event-output.ts`
- Modify: `packages/core/tests/agent-tool-capabilities.test.ts`
- Modify: `packages/core/tests/live-agent-event-output.test.ts`
- Modify: `docs/superpowers/specs/2026-08-03-live-agent-tool-harness-design.md`

- [ ] **Step 1: 写出空工具集和普通事件输出测试。**

```ts
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

expect(formatLiveAgentEvent({ type: 'turn_start' } as never)).toBe('{"type":"turn_start"}');
```

- [ ] **Step 2: 运行测试验证基线。**

Run: `pnpm exec vitest run packages/core/tests/agent-tool-capabilities.test.ts packages/core/tests/live-agent-event-output.test.ts`

Expected: PASS；能力开关已支持空工具集，普通事件会格式化为 JSON。

- [ ] **Step 3: 以空 Provider 装配 Agent。**

在 `run-live-agent.ts` 删除 `LiveAgentTestToolProvider`、`assertLiveAgentResult`、`LiveAgentToolCall` 与 `AgentOutput` 导入，改为：

```ts
import { StaticToolProvider } from '../../plugins/tool/static/index.js';

const assembly = await createAgentFromEnv({
  paths: createDefaultAgentPaths({
    agentDir: tempDir,
    homeAgentDir: join(homedir(), '.rem-agent'),
  }),
  toolProvider: new StaticToolProvider(),
  skillProvider: new EmptySkillProvider(),
});
```

循环中无条件执行 `writeLine(formatLiveAgentEvent(event))` 并收集 `error` 消息。循环后输出 `最终输出：${output?.content ?? '[无输出]'}`；若 errors 非空返回 `{ exitCode: 1 }`，否则返回 `{ exitCode: 0 }`。删除 `summarizeRun`、`formatCalls`、`safeJson`。

- [ ] **Step 4: 去除事件过滤。**

删除 `isImportantLiveAgentEvent`。`formatLiveAgentEvent` 对工具、错误和完成事件保留中文摘要；默认分支使用 `JSON.stringify(event) ?? 'undefined'`，使每一个普通流式事件可见。

- [ ] **Step 5: 更新旧设计的状态并做完整验证。**

在 `docs/superpowers/specs/2026-08-03-live-agent-tool-harness-design.md` 顶部添加：

```md
> 已由 `2026-08-04-live-agent-observation-design.md` 取代。
```

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`

Expected: 全部通过，且没有新增结构违规。

- [ ] **Step 6: 以真实 Provider 手动验证。**

Run: `pnpm test:agent:live -- --task '你好'`

Expected: 输出 `agent_start`、`turn_start`、消息事件、`turn_end`、`finish` 和最终输出；没有 `get_test_data`、`record_result`、文件、Shell、技能、委派或 Todo 工具。Provider 配置错误时输出 Core 错误事件并以状态码 1 退出。

- [ ] **Step 7: 提交实现与计划。**

```bash
git add packages/core/src/testing/live-agent packages/core/tests \
  docs/superpowers/specs/2026-08-03-live-agent-tool-harness-design.md \
  docs/superpowers/plans/2026-08-04-live-agent-observation.md
git add -u packages/core/src/testing/live-agent packages/core/tests
git commit -m "refactor: simplify live agent observation command"
```
