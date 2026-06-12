# LLM Provider generate() 测试覆盖补全计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 OpenAI 与 Anthropic Provider 的 `generate()` 非流式调用测试覆盖，并补全 `stream()` 工具调用场景，确保 P0 Provider 实现稳定可靠。

**Architecture:** 基于现有 `packages/core/src/llm/providers/openai.ts` 与 `anthropic.ts`，通过 vitest + `vi.mock()` 拦截 SDK 调用，验证消息转换、工具调用解析、usage 统计、异常传播等行为。不修改 Provider 实现，只增加测试。

**Tech Stack:** TypeScript, vitest, openai SDK, @anthropic-ai/sdk

---

## 文件结构

- **测试目标**
  - `packages/core/tests/llm/providers/openai.test.ts` — OpenAI Provider 测试
  - `packages/core/tests/llm/providers/anthropic.test.ts` — Anthropic Provider 测试
- **被测实现（只读）**
  - `packages/core/src/llm/providers/openai.ts`
  - `packages/core/src/llm/providers/anthropic.ts`

---

### Task 1: OpenAI generate() 系统消息与历史消息测试

**Files:**
- Test: `packages/core/tests/llm/providers/openai.test.ts`

- [ ] **Step 1: 编写失败测试 — 系统消息应作为第一条 message 传入**

在 `openai.test.ts` 的 `describe('openaiProvider', () => { ... })` 内追加：

```typescript
  it('should pass system message as first message in generate()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK', tool_calls: [] } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      system: 'You are a tester',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'You are a tester' },
          { role: 'user', content: 'Hi' },
        ],
      }),
      expect.anything(),
    );
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run packages/core/tests/llm/providers/openai.test.ts --reporter=verbose`

Expected: FAIL（测试尚不存在，会报 `should pass system message...` 未找到；实际应为新增测试直接通过）

- [ ] **Step 3: 验证测试通过**

Run: `npx vitest run packages/core/tests/llm/providers/openai.test.ts --reporter=verbose`

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/core/tests/llm/providers/openai.test.ts
git commit -m "test(openai): verify system message conversion in generate()"
```

---

### Task 2: OpenAI generate() 工具结果消息转换测试

**Files:**
- Test: `packages/core/tests/llm/providers/openai.test.ts`

- [ ] **Step 1: 编写失败测试 — tool 角色消息应转换为 OpenAI tool 消息**

```typescript
  it('should convert tool result messages in generate()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Done', tool_calls: [] } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [
        { role: 'tool', toolCallId: 'tc1', content: '42' } as any,
      ],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'tool', tool_call_id: 'tc1', content: '42' },
        ],
      }),
      expect.anything(),
    );
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run packages/core/tests/llm/providers/openai.test.ts::'should convert tool result messages in generate()' --reporter=verbose`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/llm/providers/openai.test.ts
git commit -m "test(openai): verify tool result message conversion in generate()"
```

---

### Task 3: OpenAI generate() 异常传播测试

**Files:**
- Test: `packages/core/tests/llm/providers/openai.test.ts`

- [ ] **Step 1: 编写失败测试 — SDK 异常应直接抛出**

```typescript
  it('should propagate errors from generate()', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('rate limited'));

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    await expect(openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toThrow('rate limited');
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run packages/core/tests/llm/providers/openai.test.ts::'should propagate errors from generate()' --reporter=verbose`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/llm/providers/openai.test.ts
git commit -m "test(openai): verify error propagation in generate()"
```

---

### Task 4: OpenAI stream() 工具调用测试

**Files:**
- Test: `packages/core/tests/llm/providers/openai.test.ts`

- [ ] **Step 1: 编写失败测试 — 流式响应中的 tool_calls 应被解析**

```typescript
  it('should stream tool-call chunks', async () => {
    async function* mockStream() {
      yield {
        choices: [{
          delta: {
            tool_calls: [{
              id: 'tc1',
              function: { name: 'echo', arguments: '{"msg":"hi"}' },
            }],
          },
        }],
      };
      yield { usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } };
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const chunks: any[] = [];
    for await (const chunk of openaiProvider.stream({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    const toolCalls = chunks.filter(c => c.type === 'tool-call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe('tc1');
    expect(toolCalls[0].toolName).toBe('echo');
    expect(toolCalls[0].input).toEqual({ msg: 'hi' });
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run packages/core/tests/llm/providers/openai.test.ts::'should stream tool-call chunks' --reporter=verbose`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/llm/providers/openai.test.ts
git commit -m "test(openai): verify tool-call parsing in stream()"
```

---

### Task 5: Anthropic generate() 系统消息测试

**Files:**
- Test: `packages/core/tests/llm/providers/anthropic.test.ts`

- [ ] **Step 1: 编写失败测试 — system 应作为顶层参数传入**

```typescript
  it('should pass system as top-level parameter in generate()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 3, output_tokens: 1 },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      system: 'You are a tester',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a tester',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      expect.anything(),
    );
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run packages/core/tests/llm/providers/anthropic.test.ts::'should pass system as top-level parameter in generate()' --reporter=verbose`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/llm/providers/anthropic.test.ts
git commit -m "test(anthropic): verify system parameter in generate()"
```

---

### Task 6: Anthropic generate() 工具结果消息转换测试

**Files:**
- Test: `packages/core/tests/llm/providers/anthropic.test.ts`

- [ ] **Step 1: 编写失败测试 — tool 角色消息应转换为 tool_result 块**

```typescript
  it('should convert tool result messages in generate()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Done' }],
      usage: { input_tokens: 5, output_tokens: 1 },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [
        { role: 'tool', toolCallId: 'tc1', content: '42' } as any,
      ],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tc1',
            content: '42',
          }],
        }],
      }),
      expect.anything(),
    );
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run packages/core/tests/llm/providers/anthropic.test.ts::'should convert tool result messages in generate()' --reporter=verbose`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/llm/providers/anthropic.test.ts
git commit -m "test(anthropic): verify tool result message conversion in generate()"
```

---

### Task 7: Anthropic generate() 异常传播测试

**Files:**
- Test: `packages/core/tests/llm/providers/anthropic.test.ts`

- [ ] **Step 1: 编写失败测试 — SDK 异常应直接抛出**

```typescript
  it('should propagate errors from generate()', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('overloaded'));

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    await expect(anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toThrow('overloaded');
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run packages/core/tests/llm/providers/anthropic.test.ts::'should propagate errors from generate()' --reporter=verbose`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/llm/providers/anthropic.test.ts
git commit -m "test(anthropic): verify error propagation in generate()"
```

---

### Task 8: Anthropic stream() 工具调用测试

**Files:**
- Test: `packages/core/tests/llm/providers/anthropic.test.ts`

- [ ] **Step 1: 编写失败测试 — 流式响应中的 tool_use 应被解析**

```typescript
  it('should stream tool_use chunks', async () => {
    async function* mockStream() {
      yield {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'tc1',
          name: 'echo',
          input: { msg: 'hi' },
        },
      };
      yield {
        type: 'message_delta',
        usage: { output_tokens: 5 },
      };
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const chunks: any[] = [];
    for await (const chunk of anthropicProvider.stream({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    const toolCalls = chunks.filter(c => c.type === 'tool-call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe('tc1');
    expect(toolCalls[0].toolName).toBe('echo');
    expect(toolCalls[0].input).toEqual({ msg: 'hi' });
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run packages/core/tests/llm/providers/anthropic.test.ts::'should stream tool_use chunks' --reporter=verbose`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/llm/providers/anthropic.test.ts
git commit -m "test(anthropic): verify tool_use parsing in stream()"
```

---

### Task 9: 全量测试验证与计划文档提交

**Files:**
- Plan: `docs/superpowers/plans/2026-06-12-llm-provider-generate-coverage.md`

- [ ] **Step 1: 运行 core 完整测试套件**

Run: `npx vitest run packages/core/tests/ --reporter=verbose`

Expected: 全部通过

- [ ] **Step 2: 提交计划文档（如果之前未提交）**

```bash
git add docs/superpowers/plans/2026-06-12-llm-provider-generate-coverage.md
git commit -m "docs(plan): add P1 generate() coverage plan"
```

---

## 自我审查

**1. Spec 覆盖：**
- P1 第 1 项「非流式 fallback（`generate()` 完整测试覆盖）」已由 Task 1-3、5-7 覆盖。
- stream() 工具调用覆盖由 Task 4、8 补充。

**2. Placeholder 扫描：**
- 无 TBD/TODO。
- 每个 step 均包含完整测试代码与命令。

**3. 类型一致性：**
- 测试使用 `as any` 转换 `tool` 角色消息，与现有测试风格一致。
- 沿用了现有 `vi.mocked(OpenAI)` / `vi.mocked(Anthropic)` 的 mock 模式。

---

*Plan date: 2026-06-12*
