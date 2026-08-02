# 真实 LLM Agent 工具测试 Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供一个显式运行、使用真实 Provider 的 Agent 测试命令；仅向 Agent 暴露内存测试工具，并可断言结构化工具结果。

**Architecture:** 在 Agent loop 装配层加入默认开启的内置工具开关，让 live harness 能精确禁用 `read_skill`、`delegate_task` 和 `todowrite`，同时不改变现有生产 Agent 的工具集。Harness 的参数解析、内存工具、断言、运行协调和 CLI 入口分离；运行协调仍只通过 Core 的 `createAgentFromEnv()` 解析模型配置与认证。

**Tech Stack:** TypeScript（NodeNext）、Node.js `util.parseArgs`/`util.isDeepStrictEqual`、TypeBox、Vitest、tsx、`@earendil-works/pi-ai` / `pi-agent-core`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/core/src/runtime/agent-tool-capabilities.ts` | 内置工具开关的类型与默认语义。 |
| `packages/core/src/runtime/agent-tools.ts` | 依据开关选择是否叠加 `read_skill`。 |
| `packages/core/src/runtime/agent-loop-assembler.ts` | 依据开关选择是否叠加委派和 Todo 工具。 |
| `packages/core/src/agent/rem-agent-params.ts` | 将工具开关作为 `REMAgent` 的可选参数向装配层传递。 |
| `packages/core/src/testing/live-agent/*.ts` | live harness 的非稳定内部实现：选项、测试工具、断言、运行协调与输出。 |
| `packages/core/scripts/run-live-agent.ts` | 仅负责读取 argv、调用 harness、设置退出码的可执行入口。 |
| `packages/core/tests/*.test.ts` | 不依赖网络或密钥的能力开关、参数、工具与断言单元测试。 |
| `package.json` | 根级 `test:agent:live` 显式命令。 |

### Task 1: 为一次 Agent run 添加可关闭的内置工具

**Files:**

- Create: `packages/core/src/runtime/agent-tool-capabilities.ts`
- Modify: `packages/core/src/agent/rem-agent-params.ts`
- Modify: `packages/core/src/runtime/agent-tools.ts`
- Modify: `packages/core/src/runtime/agent-loop-assembler.ts`
- Modify: `packages/core/tests/helpers/test-agent.ts`
- Test: `packages/core/tests/agent-tool-capabilities.test.ts`

- [ ] **Step 1: 写出默认兼容与完全隔离的失败测试。**

```ts
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
```

- [ ] **Step 2: 运行测试，确认隔离用例失败。**

Run: `pnpm exec vitest run packages/core/tests/agent-tool-capabilities.test.ts`

Expected: 第二个用例失败，因为现有 loop 一律叠加 `read_skill`、`delegate_task` 和 `todowrite`。

- [ ] **Step 3: 定义最小的能力开关类型。**

在 `packages/core/src/runtime/agent-tool-capabilities.ts` 添加：

```ts
/** 缺省为 true；仅用于需要缩减内置工具集的单次 Agent run。 */
export interface AgentToolCapabilities {
  readSkill?: boolean;
  delegateTask?: boolean;
  todoWrite?: boolean;
}

export function isToolCapabilityEnabled(
  capabilities: AgentToolCapabilities | undefined,
  name: keyof AgentToolCapabilities,
): boolean {
  return capabilities?.[name] !== false;
}
```

在 `REMAgentParams` 和 `AgentLoopAssemblyInput` 添加 `toolCapabilities?: AgentToolCapabilities`，并由 `REMAgent.ensureInitialized()` 的展开参数自动传递。`TestAgentParams` 增加同名字段并传给 `new REMAgent(...)`。

- [ ] **Step 4: 让工具装配尊重开关且保持默认行为。**

将 `createAgentTools` 的参数改为接收 `includeSkillReadTool: boolean`、可选的 `delegateToolProviderEntry` 和 `todoToolProviderEntry`；仅在 `includeSkillReadTool` 为真时调用 `composeToolProviders`，并只将非 `undefined` 的 overlay entry 交给 `ToolOverlay`。在 `assembleAgentLoop` 中使用 `isToolCapabilityEnabled`：

```ts
const capabilities = input.toolCapabilities;
const agentTools = createAgentTools({
  toolProvider: di.toolProvider,
  skillProvider: di.skillProvider,
  includeSkillReadTool: isToolCapabilityEnabled(capabilities, 'readSkill'),
  delegateToolProviderEntry: isToolCapabilityEnabled(capabilities, 'delegateTask')
    ? defineOverlayTool(createDelegateTaskToolDefinition(), createDelegateTaskExecutor(runDelegation))
    : undefined,
  todoToolProviderEntry: isToolCapabilityEnabled(capabilities, 'todoWrite')
    ? defineOverlayTool(createTodoWriteToolDefinition(), createTodoWriteToolExecutor(new TodoUsecase(di.storage.todoStore), input.emitMeta))
    : undefined,
  workspaceRoot: resolution.workspaceRoot,
  agentName: behavior.name,
  sessionId,
  orchestrationToolProviderEntries: input.orchestrationActions ? [/* 保持既有编排 overlays */] : [],
});
```

保留现有 `orchestrationToolProviderEntries` 逻辑不变；live harness 不传 `orchestrationActions`，因而不会出现编排工具。

- [ ] **Step 5: 运行新增与受影响的 Agent 测试。**

Run: `pnpm exec vitest run packages/core/tests/agent-tool-capabilities.test.ts packages/core/tests/rem-agent.test.ts`

Expected: PASS；既有测试继续观察到默认内置工具，隔离用例只观察到 `get_test_data`。

- [ ] **Step 6: 提交能力开关。**

```bash
git add packages/core/src/runtime/agent-tool-capabilities.ts \
  packages/core/src/agent/rem-agent-params.ts \
  packages/core/src/runtime/agent-tools.ts \
  packages/core/src/runtime/agent-loop-assembler.ts \
  packages/core/tests/helpers/test-agent.ts \
  packages/core/tests/agent-tool-capabilities.test.ts
git commit -m "feat(core): allow runs to disable builtin tools"
```

### Task 2: 实现内存测试工具、命令选项和结果断言

**Files:**

- Create: `packages/core/src/testing/live-agent/types.ts`
- Create: `packages/core/src/testing/live-agent/command-options.ts`
- Create: `packages/core/src/testing/live-agent/test-tool-provider.ts`
- Create: `packages/core/src/testing/live-agent/result-assertion.ts`
- Test: `packages/core/tests/live-agent-command-options.test.ts`
- Test: `packages/core/tests/live-agent-test-tool-provider.test.ts`
- Test: `packages/core/tests/live-agent-result-assertion.test.ts`

- [ ] **Step 1: 写参数解析和 JSON 校验的失败测试。**

```ts
it('解析任务、fixture 和预期结果', () => {
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

it.each([['--data', '{bad'], ['--expect-result', '[]']])(
  '拒绝无效 JSON 或非对象结果', (...argv) => {
    expect(() => parseLiveAgentCommandOptions(['--task', 'x', ...argv])).toThrow();
  },
);
```

- [ ] **Step 2: 运行选项测试，确认模块尚不存在。**

Run: `pnpm exec vitest run packages/core/tests/live-agent-command-options.test.ts`

Expected: FAIL，找不到 `parseLiveAgentCommandOptions` 导入模块。

- [ ] **Step 3: 实现选项与共享类型。**

在 `types.ts` 定义：

```ts
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
```

在 `command-options.ts` 使用 `node:util` 的 `parseArgs`，只接受 `task`、`data`、`expect-result`、`keep-output`。省略 `data` 时返回 `{ orders: { 'A-100': { status: 'paid' } } }`。`task` 为空、未知参数、JSON 语法错误、或 `expect-result` 非普通对象时抛出包含参数名的 `Error`。

- [ ] **Step 4: 写内存工具与断言的失败测试。**

```ts
it('get_test_data 与 record_result 按调用顺序记录且不产生外部副作用', async () => {
  const provider = new LiveAgentTestToolProvider({ answer: 42 });
  const context = { cwd: '/', workspaceRoot: '/', sessionId: 'live-1' };
  await provider.execute([{ toolCallId: '1', toolName: 'get_test_data', input: {} }], context);
  await provider.execute([{ toolCallId: '2', toolName: 'record_result', input: { answer: 42 } }], context);
  expect(provider.calls).toEqual([
    { sequence: 1, toolName: 'get_test_data', input: {} },
    { sequence: 2, toolName: 'record_result', input: { answer: 42 } },
  ]);
});

it('要求最后一次 record_result 与预期对象深度相等', () => {
  expect(assertLiveAgentResult([
    { sequence: 1, toolName: 'record_result', input: { status: 'paid' } },
  ], { status: 'paid' })).toEqual({ passed: true });
  expect(assertLiveAgentResult([], { status: 'paid' })).toMatchObject({ passed: false });
});
```

- [ ] **Step 5: 实现工具 Provider 与断言。**

`LiveAgentTestToolProvider` 继承 `StaticToolProvider`，以 TypeBox 注册以下定义：

```ts
const getTestData = {
  name: 'get_test_data',
  description: 'Return the in-memory test fixture. Call this before deciding the result.',
  parameters: Type.Object({ key: Type.Optional(Type.String()) }, { additionalProperties: false }),
};
const recordResult = {
  name: 'record_result',
  description: 'Record the final structured result for this test task.',
  parameters: Type.Object({}, { additionalProperties: true }),
};
```

`get_test_data` 在 `key` 缺省时 `JSON.stringify(data)`，提供 `key` 时仅从顶层对象读取对应值并序列化；`record_result` 记录输入并返回 `"result recorded"`。两个 executor 都只操作对象字段，不导入文件、网络或子进程 API。

`assertLiveAgentResult` 始终要求至少一次 `record_result`；有预期时查找最后一次调用并用 `isDeepStrictEqual` 比较，失败结果返回可直接打印的原因文本。

- [ ] **Step 6: 运行所有纯逻辑测试。**

Run: `pnpm exec vitest run packages/core/tests/live-agent-command-options.test.ts packages/core/tests/live-agent-test-tool-provider.test.ts packages/core/tests/live-agent-result-assertion.test.ts`

Expected: PASS，且没有网络请求。

- [ ] **Step 7: 提交可观测测试组件。**

```bash
git add packages/core/src/testing/live-agent \
  packages/core/tests/live-agent-command-options.test.ts \
  packages/core/tests/live-agent-test-tool-provider.test.ts \
  packages/core/tests/live-agent-result-assertion.test.ts
git commit -m "feat(core): add in-memory live agent test tools"
```

### Task 3: 装配真实 Provider 运行协调器与 CLI

**Files:**

- Create: `packages/core/src/testing/live-agent/event-output.ts`
- Create: `packages/core/src/testing/live-agent/run-live-agent.ts`
- Create: `packages/core/scripts/run-live-agent.ts`
- Modify: `package.json`
- Test: `packages/core/tests/live-agent-event-output.test.ts`
- Modify: `docs/superpowers/specs/2026-08-03-live-agent-tool-harness-design.md`

- [ ] **Step 1: 写事件摘要格式化的失败测试。**

```ts
it('将工具执行与终态事件压缩成可读行', () => {
  expect(formatLiveAgentEvent({ type: 'tool_execution_start', toolCall: {
    toolCallId: 'call-1', toolName: 'get_test_data', input: {},
  }} as never)).toContain('get_test_data');
  expect(formatLiveAgentEvent({ type: 'finish', output: {
    content: '订单已支付', completed: true,
  }})).toContain('完成');
});
```

- [ ] **Step 2: 运行格式化测试，确认它失败。**

Run: `pnpm exec vitest run packages/core/tests/live-agent-event-output.test.ts`

Expected: FAIL，找不到 `formatLiveAgentEvent`。

- [ ] **Step 3: 实现真实运行协调器。**

`runLiveAgent.ts` 导出 `runLiveAgent(options, writeLine)`。它必须：

```ts
const tempDir = await mkdtemp(join(tmpdir(), 'rem-agent-live-'));
try {
  const paths = createDefaultAgentPaths({
    agentDir: tempDir,
    homeAgentDir: join(homedir(), '.rem-agent'),
  });
  const toolProvider = new LiveAgentTestToolProvider(options.data);
  const assembly = await createAgentFromEnv({
    paths,
    toolProvider,
    skillProvider: new EmptySkillProvider(),
  });
  const session = await assembly.di.sessionProvider.create();
  session.metadata.title = 'Live agent tool harness';
  const agent = new REMAgent({
    di: assembly.di,
    runtimeConfig: assembly.runtimeConfig,
    session,
    sessionId: session.sessionId,
    agentId: 'live-test',
    workspace: process.cwd(),
    toolCapabilities: { readSkill: false, delegateTask: false, todoWrite: false },
  });
  for await (const event of agent.run({ content: options.task })) {
    const line = formatLiveAgentEvent(event);
    if (line && (options.keepOutput || isImportantLiveAgentEvent(event))) writeLine(line);
  }
  const output = await agent.output;
  return finishLiveAgentRun(output, toolProvider.calls, options.expectedResult, writeLine);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
```

`finishLiveAgentRun` 必须在 `output` 缺失、`output.completed === false`、收到 `error` 事件，或 `assertLiveAgentResult` 失败时返回 `{ exitCode: 1 }`；否则返回 `{ exitCode: 0 }`。无论结果如何，输出最终文本、按序号列出工具调用、并打印 `PASS` 或 `FAIL` 摘要。临时目录只用于默认 SQLite storage，finally 中始终删除；Provider 配置继续从既有 home/workspace 配置和环境变量由 Core 解析。

- [ ] **Step 4: 实现薄 CLI 并注册命令。**

`packages/core/scripts/run-live-agent.ts` 保持为薄入口：

```ts
import { parseLiveAgentCommandOptions } from '../src/testing/live-agent/command-options.js';
import { runLiveAgent } from '../src/testing/live-agent/run-live-agent.js';

async function main(): Promise<void> {
  const options = parseLiveAgentCommandOptions(process.argv.slice(2));
  const result = await runLiveAgent(options, (line) => process.stdout.write(`${line}\n`));
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
```

在根 `package.json` 增加：

```json
"test:agent:live": "pnpm --filter rem-agent-core exec tsx scripts/run-live-agent.ts"
```

不要把该命令加到 `test`、`build` 或任何 CI 聚合命令。

- [ ] **Step 5: 更新设计说明的实现细节。**

在设计说明的“范围与边界”补充：Harness 使用 `AgentToolCapabilities` 关闭 `read_skill`、`delegate_task` 和 `todowrite`；仅 `get_test_data`、`record_result` 会出现在模型可调用工具列表。这样文档与实际 Core overlay 行为一致。

- [ ] **Step 6: 运行 CLI 的安全失败验证与完整离线检查。**

Run: `pnpm test:agent:live -- --task '调用 get_test_data 并使用 record_result 记录答案'`

Expected: 在未配置真实 Provider 时，打印 Core 的配置/模型错误并以状态码 `1` 退出；不得出现任何文件或 Shell 工具。

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`

Expected: 构建、类型检查和测试通过；结构检查仅保留仓库已知的 `agent/rem-agent.ts` 文件长度和 `agent → plugins` 依赖问题，不能出现新违规。

- [ ] **Step 7: 在已配置 Provider 的开发环境手动成功验证。**

Run:

```bash
pnpm test:agent:live -- \
  --task '调用 get_test_data 查询订单 A-100 的状态，然后调用 record_result 记录 orderId 和 status。' \
  --data '{"orders":{"A-100":{"status":"paid"}}}' \
  --expect-result '{"orderId":"A-100","status":"paid"}'
```

Expected: 状态码 `0`，输出中仅列出 `get_test_data`、`record_result` 两种工具，最后显示 `PASS`。若本机没有 Provider 凭据，记录为“因缺少外部凭据未执行成功路径”，而不是伪造成功结果。

- [ ] **Step 8: 提交运行入口与文档。**

```bash
git add package.json \
  packages/core/src/testing/live-agent/event-output.ts \
  packages/core/src/testing/live-agent/run-live-agent.ts \
  packages/core/scripts/run-live-agent.ts \
  packages/core/tests/live-agent-event-output.test.ts \
  docs/superpowers/specs/2026-08-03-live-agent-tool-harness-design.md
git commit -m "feat: add live agent tool test command"
```
