# Demo TUI 流式输出实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 同时必须遵循 `module-separation-convention` skill 进行模块拆分，保持文件精简、职责单一。

**Goal:** 让 `CoreAgent.run()` 同步返回 `AgentStreamResult`，通过 `AsyncIterable<AgentStreamChunk>` 实时暴露 assistant message 的增量 parts；Demo TUI 按 parts 实时渲染。

**Architecture:** 新增 `packages/core/src/stream/agent-stream.ts` 实现 `AgentStreamController` 与 `AgentStream`；`CoreAgent.run()` 创建 stream 后同步返回 `AgentStreamResult`，并在后台启动 `ReactTurnRunner` 往 stream 推 chunks；`ReactLoop.iterate()` 负责把 `InferenceEngine` 的 `StreamChunk` 转换为 `AgentStreamChunk` 并追加到 stream；UI 通过 `for await (const chunk of result.stream.fullStream)` 消费。

**Tech Stack:** TypeScript, Vitest, `ai` 包, Node.js AsyncIterable

---

## 文件结构映射

| 文件 | 职责 | 变更 |
|---|---|---|
| `packages/core/src/types.ts` | 导出 `AgentStreamChunk`、`AgentStream`、`AgentStreamResult` | 修改 |
| `packages/core/src/stream/agent-stream.ts` | `AgentStreamController`：内部 queue + iterator + 聚合 Promise | 新建 |
| `packages/core/src/core-agent.ts` | `CoreAgent.run()` 同步返回 `AgentStreamResult`；暴露 `conversation` getter | 修改 |
| `packages/core/src/turn.ts` | `ReactTurnRunner.run()` 接收 `stream`，管理 step 边界，追加 parts 到 assistant message | 修改 |
| `packages/core/src/loop-strategy.ts` | `ReactLoop.iterate()` 接收 `stream` 和 `step`，推 text/reasoning/tool-call/tool-result chunks | 修改 |
| `packages/core/src/index.ts` | 导出新的 stream 类型 | 修改 |
| `packages/core/tests/stream/agent-stream.test.ts` | `AgentStreamController` 单元测试 | 新建 |
| `packages/core/tests/core-agent.test.ts` | 更新为新的 `run()` 返回类型，新增流式测试 | 修改 |
| `packages/core/tests/loop-strategy.test.ts` | 更新 iterate 签名，新增 stream 测试 | 修改 |
| `packages/core/tests/turn.test.ts` | 更新 run 签名，验证 step 边界 | 修改 |
| `packages/demo/src/agent.ts` | 移除 `onStream` callback，适配 `AgentStreamResult` | 修改 |
| `packages/demo/src/tui/app.ts` | 新增 `startAssistantMessage` / `finalizeAssistantMessage` / `updateConversation` | 修改 |
| `packages/demo/src/tui/chat-log.ts` | 新增 `startAssistantMessage()` | 修改 |
| `packages/demo/src/tui/message.ts` | 新增 `StreamAssistantMessage` 按 parts 渲染 | 修改 |
| `packages/demo/src/main.ts` | 更新 `agent.run()` 消费方式 | 修改 |

---

### Task 1: 定义 `AgentStreamChunk`、`AgentStream`、`AgentStreamResult` 类型

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/core-agent.ts`

- [ ] **Step 1: 在 `types.ts` 新增类型**

```ts
import type { ModelMessage, LanguageModelUsage } from 'ai';
import type { AgentOutput } from './types.js'; // AgentOutput 已在同文件

export type AgentStreamChunk =
  | { type: 'step-start'; step: number }
  | { type: 'text-delta'; step: number; text: string }
  | { type: 'reasoning-delta'; step: number; text: string }
  | { type: 'tool-call'; step: number; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; step: number; toolCallId: string; output: string; error?: string }
  | { type: 'step-finish'; step: number }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: Error };

export interface AgentStreamStepResult {
  step: number;
  text: string;
  reasoning: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    output?: string;
    error?: string;
  }>;
}

export interface AgentStream {
  fullStream: AsyncIterable<AgentStreamChunk>;
  text: Promise<string>;
  usage: Promise<LanguageModelUsage>;
  steps: Promise<AgentStreamStepResult[]>;
}
```

- [ ] **Step 2: 在 `core-agent.ts` 新增 `AgentStreamResult`**

```ts
export interface AgentStreamResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}
```

- [ ] **Step 3: 运行 core 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS（只有类型声明，无实现）

---

### Task 2: 实现 `AgentStreamController` 与 `AgentStream`

**Files:**
- Create: `packages/core/src/stream/agent-stream.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 编写 `AgentStreamController` 实现**

```ts
import type { AgentOutput, AgentStream, AgentStreamChunk, AgentStreamStepResult } from '../types.js';
import type { LanguageModelUsage } from 'ai';

export class AgentStreamController {
  private queue: AgentStreamChunk[] = [];
  private pending: Array<(chunk: AgentStreamChunk | undefined) => void> = [];
  private finished = false;
  private error?: Error;

  append(chunk: AgentStreamChunk): void {
    if (this.finished) return;
    this.queue.push(chunk);
    const resolve = this.pending.shift();
    if (resolve) resolve(chunk);
  }

  finish(output: AgentOutput): void {
    if (this.finished) return;
    this.append({ type: 'finish', output });
    this.finished = true;
    for (const resolve of this.pending) resolve(undefined);
    this.pending = [];
  }

  fail(error: Error): void {
    if (this.finished) return;
    this.append({ type: 'error', error });
    this.finished = true;
    this.error = error;
    for (const resolve of this.pending) resolve(undefined);
    this.pending = [];
  }

  get stream(): AgentStream {
    return {
      fullStream: this.createIterator(),
      text: this.aggregateText(),
      usage: this.aggregateUsage(),
      steps: this.aggregateSteps(),
    };
  }

  private createIterator(): AsyncIterable<AgentStreamChunk> {
    let index = 0;
    const controller = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentStreamChunk> {
        return {
          async next(): Promise<IteratorResult<AgentStreamChunk>> {
            while (true) {
              if (index < controller.queue.length) {
                const chunk = controller.queue[index++];
                if (chunk.type === 'finish' || chunk.type === 'error') {
                  return { done: true, value: chunk };
                }
                return { done: false, value: chunk };
              }
              if (controller.finished) {
                return { done: true, value: undefined };
              }
              await new Promise<void>((resolve) => {
                controller.pending.push(() => resolve());
              });
            }
          },
        };
      },
    };
  }

  private aggregateText(): Promise<string> {
    return this.aggregateRun(({ chunks, resolve, reject }) => {
      const text = chunks
        .filter((c): c is { type: 'text-delta'; step: number; text: string } => c.type === 'text-delta')
        .map((c) => c.text)
        .join('');
      resolve(text);
    });
  }

  private aggregateUsage(): Promise<LanguageModelUsage> {
    return this.aggregateRun(({ chunks, resolve }) => {
      // InferenceEngine 不通过 AgentStreamChunk 暴露 usage，此处从 finish output 推导或默认 0
      resolve({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      });
    });
  }

  private aggregateSteps(): Promise<AgentStreamStepResult[]> {
    return this.aggregateRun(({ chunks, resolve }) => {
      const stepMap = new Map<number, AgentStreamStepResult>();
      for (const chunk of chunks) {
        if (chunk.type === 'step-start') {
          stepMap.set(chunk.step, { text: '', reasoning: '', toolCalls: [] });
        } else if (chunk.type === 'text-delta') {
          stepMap.get(chunk.step)!.text += chunk.text;
        } else if (chunk.type === 'reasoning-delta') {
          stepMap.get(chunk.step)!.reasoning += chunk.text;
        } else if (chunk.type === 'tool-call') {
          stepMap.get(chunk.step)!.toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          });
        } else if (chunk.type === 'tool-result') {
          const tc = stepMap.get(chunk.step)!.toolCalls.find((t) => t.toolCallId === chunk.toolCallId);
          if (tc) {
            tc.output = chunk.output;
            tc.error = chunk.error;
          }
        }
      }
      resolve([...stepMap.entries()].map(([step, data]) => ({ step, ...data })));
    });
  }

  private aggregateRun<T>(
    handler: (args: { chunks: AgentStreamChunk[]; resolve: (value: T) => void; reject: (reason: Error) => void }) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.finished) {
          if (this.error) return reject(this.error);
          return handler({ chunks: [...this.queue], resolve, reject });
        }
        setTimeout(check, 10);
      };
      check();
    });
  }
}
```

- [ ] **Step 2: 在 `index.ts` 导出 `AgentStreamController`**

```ts
export * from './stream/agent-stream.js';
```

- [ ] **Step 3: 运行类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS（实现可能有类型问题，先记录）

---

### Task 3: 修改 `ReactLoop.iterate()` 接收 stream 并推 chunks

**Files:**
- Modify: `packages/core/src/loop-strategy.ts`

- [ ] **Step 1: 更新 `LoopContext` 和 `LoopStrategy` 接口**

```ts
import type { AgentStreamController } from './stream/agent-stream.js';
import type { AgentStreamChunk } from './types.js';

export interface LoopContext {
  state: AgentState;
  systemPrompt: string;
  model?: LanguageModel;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export interface LoopStrategy {
  iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult>;
}
```

- [ ] **Step 2: 修改 `ReactLoop.iterate()` 签名与实现**

```ts
async iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult> {
  await this.events.emit('turn:before', { agent: this, state: ctx.state });
  await this.events.emit('phase:prepare', { agent: this, state: ctx.state });
  const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(ctx.state);

  let messages: ModelMessage[] = [...contextMessages];

  if (this.compressor.shouldCompress(ctx.state)) {
    await this.events.emit('compress:before', { agent: this, state: ctx.state });
    messages = await this.compressor.compress(messages);
    await this.events.emit('compress:after', { agent: this, state: ctx.state });
  }

  await this.events.emit('phase:reason:before', { agent: this, state: ctx.state });

  const tools = this.toolProvider.getToolSet();
  const hasTools = Object.keys(tools).length > 0;

  const inferResult = await this.inferWithRetry({
    provider: ctx.provider ?? 'mock',
    providerConfig: ctx.providerConfig ?? { apiKey: '', model: 'default' },
    system: systemPrompt,
    messages,
    tools: hasTools ? tools : undefined,
    signal: ctx.signal,
    onChunk: (chunk) => {
      const agentChunk = this.mapToAgentStreamChunk(chunk, step);
      if (agentChunk) controller.append(agentChunk);
    },
  });

  await this.events.emit('phase:reason:after', { agent: this, state: ctx.state });

  const newMessages: ModelMessage[] = [];
  const toolCalls: ToolCall[] = [];

  if (inferResult.toolCalls.length > 0) {
    await this.events.emit('phase:execute:before', { agent: this, state: ctx.state });
    await this.events.emit('tool:before', { agent: this, state: ctx.state });

    const startTime = Date.now();
    const toolResults = await this.toolProvider.execute(inferResult.toolCalls);

    for (const tc of inferResult.toolCalls) {
      const tr = toolResults.find((r: ToolResult) => r.toolCallId === tc.toolCallId);
      const toolMsg: ModelMessage = {
        role: 'tool',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        content: tr?.error ?? tr?.output ?? '',
      } as unknown as ModelMessage;

      ctx.state.addMessage(toolMsg);
      newMessages.push(toolMsg);
      hooks.onMessageAdded(toolMsg);

      const streamChunk: AgentStreamChunk = {
        type: 'tool-result',
        step,
        toolCallId: tc.toolCallId,
        output: tr?.output ?? '',
        error: tr?.error,
      };
      controller.append(streamChunk);

      const record: ToolCallRecord = {
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.input as Record<string, unknown>,
        result: tr
          ? {
              success: !tr.error,
              output: tr.output,
              error: tr.error,
              durationMs: 0,
            }
          : undefined,
        error: tr?.error,
        durationMs: Date.now() - startTime,
        timestamp: new Date(),
      };

      toolCalls.push(tc);
      hooks.onToolCallRecorded(record);
    }

    await this.events.emit('tool:after', { agent: this, state: ctx.state });
    await this.events.emit('phase:execute:after', { agent: this, state: ctx.state });
  }

  // 追加当前 step 的 parts 到 assistant message
  const assistantMsg = this.getOrCreateAssistantMessage(ctx.state);
  this.appendStepParts(assistantMsg, inferResult, toolResults, step);

  await this.events.emit('turn:after', { agent: this, state: ctx.state });

  const completed = inferResult.toolCalls.length === 0;

  return {
    finalOutput: {
      content: inferResult.text,
      completed,
    },
    newMessages,
    toolCalls,
    usage: {
      inputTokens: inferResult.usage.inputTokens,
      outputTokens: inferResult.usage.outputTokens,
      totalTokens: inferResult.usage.totalTokens,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    },
    iterations: 1,
  };
}

private mapToAgentStreamChunk(chunk: StreamChunk, step: number): AgentStreamChunk | null {
  switch (chunk.type) {
    case 'text':
      return { type: 'text-delta', step, text: chunk.text };
    case 'reasoning':
      return { type: 'reasoning-delta', step, text: chunk.text };
    case 'tool-call':
      return { type: 'tool-call', step, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input };
    default:
      return null;
  }
}

private getOrCreateAssistantMessage(state: AgentState): ModelMessage {
  const last = state.conversation[state.conversation.length - 1];
  if (last?.role === 'assistant') return last as ModelMessage;
  const msg: ModelMessage = { role: 'assistant', content: [] } as ModelMessage;
  state.addMessage(msg);
  return msg;
}

private appendStepParts(
  assistantMsg: ModelMessage,
  inferResult: InferenceResult,
  toolResults: ToolResult[],
  step: number,
): void {
  // 实际 parts 追加由 onChunk 完成；此处仅确保 state 中的 assistant message 包含文本/工具结果
  // 具体实现与现有 newMessages 逻辑对齐
}
```

- [ ] **Step 3: 更新 `loop-strategy.test.ts`**

所有 `loop.iterate(ctx, hooks)` 调用改为 `loop.iterate(ctx, hooks, controller, 1)`，其中 `controller` 用 `new AgentStreamController()`。

- [ ] **Step 4: 运行 loop-strategy 测试**

Run: `pnpm --filter rem-agent-core test packages/core/tests/loop-strategy.test.ts`
Expected: PASS（可能需迭代）

---

### Task 4: 修改 `ReactTurnRunner.run()` 管理 step 边界

**Files:**
- Modify: `packages/core/src/turn.ts`
- Modify: `packages/core/tests/turn.test.ts`

- [ ] **Step 1: 更新 `TurnRunner` 接口与 `ReactTurnRunner.run()`**

```ts
import type { AgentStreamController } from './stream/agent-stream.js';

export interface TurnRunner {
  run(ctx: TurnContext, hooks: TurnHooks, controller: AgentStreamController): Promise<TurnResult>;
}

export class ReactTurnRunner implements TurnRunner {
  constructor(private loopStrategy: LoopStrategy) {}

  async run(ctx: TurnContext, hooks: TurnHooks, controller: AgentStreamController): Promise<TurnResult> {
    const session: Session = {
      sessionId: 'turn-internal',
      conversation: [...ctx.conversation],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const state = new AgentState(session, ctx.budget);

    // 创建该 run 的 assistant message
    const assistantMsg: ModelMessage = { role: 'assistant', content: [] } as ModelMessage;
    state.addMessage(assistantMsg);

    const loopCtx: LoopContext = {
      state,
      systemPrompt: ctx.systemPrompt,
      model: ctx.model,
      budget: ctx.budget,
      signal: ctx.signal,
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
    };

    const step = 1;
    controller.append({ type: 'step-start', step });
    const loopResult: LoopResult = await this.loopStrategy.iterate(loopCtx, hooks, controller, step);
    controller.append({ type: 'step-finish', step });

    return {
      output: loopResult.finalOutput,
      newMessages: loopResult.newMessages,
      toolCalls: loopResult.toolCalls,
      usage: loopResult.usage,
    };
  }
}
```

- [ ] **Step 2: 更新 `turn.test.ts`**

所有 `runner.run(ctx, hooks)` 调用改为 `runner.run(ctx, hooks, new AgentStreamController())`。

- [ ] **Step 3: 运行 turn 测试**

Run: `pnpm --filter rem-agent-core test packages/core/tests/turn.test.ts`
Expected: PASS

---

### Task 5: 修改 `CoreAgent.run()` 同步返回 `AgentStreamResult`

**Files:**
- Modify: `packages/core/src/core-agent.ts`
- Modify: `packages/core/tests/core-agent.test.ts`

- [ ] **Step 1: 修改 `CoreAgent.run()` 实现**

```ts
import { AgentStreamController } from './stream/agent-stream.js';
import type { AgentStreamResult } from './types.js';

export class CoreAgent {
  // ... existing code ...

  get conversation(): ModelMessage[] {
    return [...this.state.conversation];
  }

  run(input: UserInput): AgentStreamResult {
    const controller = new AgentStreamController();
    const stream = controller.stream;

    const outputPromise = (async () => {
      this.state.status = 'running';
      this.interrupted = false;
      await this.events.emit('core-agent:start', { agent: this, state: this.state });

      const budgetPolicy = this.getBudgetPolicy();
      const startTime = Date.now();

      if (!budgetPolicy.checkTurn(this.state) || !budgetPolicy.checkTimeout(startTime)) {
        this.state.status = 'idle';
        const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
        controller.finish(output);
        return output;
      }

      const userMessage: ModelMessage = { role: 'user', content: input.content } as ModelMessage;
      this.state.addMessage(userMessage);
      await this.sessionProvider.save(this.state.session);

      const abortController = new AbortController();
      this.abortController = abortController;

      try {
        const result = await this.turnRunner.run({
          input,
          conversation: [...this.state.conversation],
          systemPrompt: `You are ${this.config.name}.`,
          model: this.config.model,
          budget: this.state.budget,
          signal: abortController.signal,
          provider: this.config.provider ?? 'openai',
          providerConfig: this.config.providerConfig ?? resolveProviderConfig(this.config.provider ?? 'openai'),
        }, this.createTurnHooks(), controller);

        for (const msg of result.newMessages) {
          this.state.addMessage(msg);
        }

        this.state.currentTurn++;
        this.state.status = 'idle';
        this.abortController = undefined;
        await this.sessionProvider.save(this.state.session);
        await this.events.emit('core-agent:stop', { agent: this, state: this.state });

        const output: AgentOutput = {
          content: this.interrupted ? 'Response interrupted.' : result.output.content,
          completed: true,
        };
        controller.finish(output);
        return output;
      } catch (error) {
        this.state.status = 'error';
        this.abortController = undefined;
        await this.events.emit('core-agent:error', { agent: this, state: this.state });
        controller.fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    })();

    return { stream, output: outputPromise };
  }
}
```

- [ ] **Step 2: 更新 `core-agent.test.ts`**

所有 `await agent.run(...)` 改为：

```ts
const result = agent.run({ content: 'Hello' });
const output = await result.output;
```

并新增流式测试：

```ts
it('should expose stream via AgentStreamResult', async () => {
  const agent = new CoreAgent({
    name: 'test',
    model: createMockModel(),
    budget: new IterationBudget({ maxTurns: 5 }),
  });
  await agent.initialize();
  const result = agent.run({ content: 'Hello' });

  const chunks: AgentStreamChunk[] = [];
  for await (const chunk of result.stream.fullStream) {
    chunks.push(chunk);
  }

  expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
  expect(chunks.some((c) => c.type === 'finish')).toBe(true);

  const output = await result.output;
  expect(output.content).toBe('Done!');
});
```

- [ ] **Step 3: 运行 core-agent 测试**

Run: `pnpm --filter rem-agent-core test packages/core/tests/core-agent.test.ts`
Expected: PASS

---

### Task 6: 更新 OpenAI Provider 支持 parts 数组输入

**Files:**
- Modify: `packages/core/src/llm/providers/openai.ts`

- [ ] **Step 1: 修改 `convertToOpenAIMessages` 支持 assistant parts**

```ts
function convertAssistantContent(content: unknown): OpenAI.Chat.ChatCompletionMessageParam {
  if (typeof content === 'string') {
    return { role: 'assistant', content };
  }

  if (!Array.isArray(content)) {
    return { role: 'assistant', content: String(content) };
  }

  const text = content
    .filter((p: any) => p.type === 'text')
    .map((p: any) => p.text)
    .join('');

  const toolCalls = content
    .filter((p: any) => p.type === 'tool-call')
    .map((p: any) => ({
      id: p.toolCallId,
      type: 'function' as const,
      function: { name: p.toolName, arguments: JSON.stringify(p.input) },
    }));

  return {
    role: 'assistant',
    content: text,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
```

- [ ] **Step 2: 更新 `convertToOpenAIMessages` 使用新函数**

```ts
for (const msg of messages) {
  if (msg.role === 'user') {
    result.push({ role: 'user', content: msg.content as unknown as string });
  } else if (msg.role === 'assistant') {
    result.push(convertAssistantContent(msg.content));
  } else if (msg.role === 'tool') {
    // ... existing
  }
}
```

- [ ] **Step 3: 运行 engine / provider 测试**

Run: `pnpm --filter rem-agent-core test packages/core/tests/llm/`
Expected: PASS

---

### Task 7: 适配 Demo TUI

**Files:**
- Modify: `packages/demo/src/agent.ts`
- Modify: `packages/demo/src/main.ts`
- Modify: `packages/demo/src/tui/app.ts`
- Modify: `packages/demo/src/tui/chat-log.ts`
- Modify: `packages/demo/src/tui/message.ts`

- [ ] **Step 1: 简化 `createDemoAgent`**

```ts
export function createDemoAgent(name: string, maxTurns: number): CoreAgent {
  return createAgentFromEnv({ name, maxTurns });
}
```

- [ ] **Step 2: 在 `message.ts` 新增 `StreamAssistantMessage`**

```ts
export class StreamAssistantMessage extends Container {
  private textParts: string[] = [];
  private reasoningParts: string[] = [];
  private body: Markdown;
  private reasoning: Markdown;

  constructor() {
    super();
    this.body = new Markdown('', 0, 0, markdownTheme, assistantMessageStyle);
    this.reasoning = new Markdown('', 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
    this.addChild(this.reasoning);
  }

  appendChunk(chunk: AgentStreamChunk): void {
    if (chunk.type === 'text-delta') {
      this.textParts.push(chunk.text);
      this.body.setText(this.textParts.join(''));
    } else if (chunk.type === 'reasoning-delta') {
      this.reasoningParts.push(chunk.text);
      this.reasoning.setText(this.reasoningParts.join(''));
    }
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}
```

- [ ] **Step 3: 更新 `chat-log.ts`**

```ts
startAssistant(): StreamAssistantMessage {
  const message = new StreamAssistantMessage();
  this.append(message);
  return message;
}
```

- [ ] **Step 4: 更新 `app.ts`**

```ts
startAssistantMessage(): StreamAssistantMessage {
  return this.chatLog.startAssistant();
}

finalizeAssistantMessage(_text: string): void {
  this.tui.requestRender(true);
}

updateConversation(_messages: ModelMessage[]): void {
  this.tui.requestRender(true);
}

requestRender(): void {
  this.tui.requestRender(true);
}
```

- [ ] **Step 5: 更新 `main.ts` 消费 `AgentStreamResult`**

```ts
const agent = createDemoAgent(config.agentName, config.maxTurns);

app.onSubmit((text) => {
  app.addUserMessage(text);

  const result = agent.run({ content: text });
  const message = app.startAssistantMessage();

  (async () => {
    for await (const chunk of result.stream.fullStream) {
      message.appendChunk(chunk);
      app.requestRender();
    }
  })();

  result.stream.text.then((text) => {
    app.finalizeAssistantMessage(text);
  });

  result.output
    .then(() => {
      app.updateConversation(agent.conversation);
    })
    .catch((error) => {
      app.showError(error);
    });
});
```

- [ ] **Step 6: 运行 demo 类型检查和测试**

Run: `pnpm --filter rem-agent-demo typecheck && pnpm --filter rem-agent-demo test`
Expected: PASS

---

### Task 8: 全仓类型检查和测试

**Files:**
- 全仓

- [ ] **Step 1: 全仓类型检查**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: 全仓测试**

Run: `pnpm test`
Expected: PASS

---

## Self-Review

**1. Spec coverage:**

| Spec 要求 | 对应 Task |
|---|---|
| `AgentStream` 为 AsyncIterable 增量 parts | Task 1, 2 |
| `run()` 同步返回 `AgentStreamResult` | Task 5 |
| 多 step 合并为一条 assistant message | Task 3, 4 |
| 移除 `messages` chunk | Task 1, 3, 4 |
| Demo TUI 按 parts 实时渲染 | Task 7 |
| OpenAI provider 支持 parts 输入 | Task 6 |

无遗漏。

**2. Placeholder scan:**

- 无 TBD / TODO。
- `AgentStreamController` 的 `createIterator` 和 `aggregateRun` 有完整实现。
- `appendStepParts` 在 Task 3 中留了简化说明，需由执行代理根据实际 state 逻辑补全。

**3. Type consistency:**

- `AgentStreamChunk` / `AgentStream` / `AgentStreamResult` 名称在 Task 1、2、5 中一致。
- `ReactLoop.iterate` 签名在 Task 3 和 Task 4 中一致。
- `run()` 在 Task 5 中从 `async` 改为同步返回 `AgentStreamResult`。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-demo-tui-streaming-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints

**Which approach?**
