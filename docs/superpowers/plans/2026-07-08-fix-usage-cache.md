# Fix Usage Cache Details Always Zero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the token usage cache statistics so that OpenAI and Anthropic cache-read/cache-write details flow from provider responses through streaming collection and loop accumulation into the UI.

**Architecture:** Parse token details inside each provider adapter, preserve them in `StreamCollector`, and replace the buggy local `addUsage` in `ReactLoop` with the already-tested `addUsage` from `token-usage.ts`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces (`packages/core`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/core/src/llm/providers/openai-adapter.ts` | Parse OpenAI responses and stream chunks | Add `inputTokenDetails` / `outputTokenDetails` extraction |
| `packages/core/src/llm/providers/anthropic-adapter.ts` | Parse Anthropic responses and stream events | Add `inputTokenDetails` / `outputTokenDetails` extraction |
| `packages/core/src/llm/stream-collector.ts` | Aggregate stream chunks into a final result | Preserve details from usage chunks |
| `packages/core/src/plugins/loop/react/index.ts` | Run multi-step ReAct loop | Reuse `emptyUsage` / `addUsage` from `token-usage.ts` |
| `packages/core/tests/llm/providers/openai.test.ts` | OpenAI provider tests | Add cache details assertions |
| `packages/core/tests/llm/providers/anthropic.test.ts` | Anthropic provider tests | Add cache details assertions |
| `packages/core/tests/llm/stream-collector.test.ts` | StreamCollector tests (new) | Verify details preservation |
| `packages/core/tests/plugins/loop/react/react-loop.test.ts` | ReactLoop tests | Add multi-step detail accumulation assertion |

---

### Task 1: OpenAI Adapter — Parse Details in `parseOpenAIResponse`

**Files:**
- Modify: `packages/core/src/llm/providers/openai-adapter.ts:76-94`

- [ ] **Step 1: Add a helper to build details from OpenAI usage**

Add this helper above `parseOpenAIResponse` (after `convertToOpenAITools`):

```typescript
function buildOpenAIInputTokenDetails(usage: OpenAI.Chat.Completions.CompletionUsage | undefined) {
  if (!usage?.prompt_tokens_details) return undefined;
  const cached = usage.prompt_tokens_details.cached_tokens ?? 0;
  return {
    noCacheTokens: Math.max(0, usage.prompt_tokens - cached),
    cacheReadTokens: cached,
  };
}

function buildOpenAIOutputTokenDetails(usage: OpenAI.Chat.Completions.CompletionUsage | undefined) {
  if (!usage?.completion_tokens_details) return undefined;
  const reasoning = usage.completion_tokens_details.reasoning_tokens ?? 0;
  return {
    textTokens: Math.max(0, usage.completion_tokens - reasoning),
    reasoningTokens: reasoning,
  };
}
```

- [ ] **Step 2: Update `parseOpenAIResponse` to include details**

Replace the `usage` block in `parseOpenAIResponse` with:

```typescript
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      inputTokenDetails: buildOpenAIInputTokenDetails(response.usage),
      outputTokenDetails: buildOpenAIOutputTokenDetails(response.usage),
    },
  };
```

- [ ] **Step 3: Type-check the changed package**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/llm/providers/openai-adapter.ts
git commit -m "fix(core/openai): parse cache token details from non-streaming response

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: OpenAI Adapter — Parse Details in `parseOpenAIChunk`

**Files:**
- Modify: `packages/core/src/llm/providers/openai-adapter.ts:142-149`

- [ ] **Step 1: Update the usage chunk yield**

Replace the `if (chunk.usage)` block with:

```typescript
  if (chunk.usage) {
    yield {
      type: 'usage',
      inputTokens: chunk.usage.prompt_tokens,
      outputTokens: chunk.usage.completion_tokens,
      totalTokens: chunk.usage.total_tokens,
      inputTokenDetails: buildOpenAIInputTokenDetails(chunk.usage as OpenAI.Chat.Completions.CompletionUsage),
      outputTokenDetails: buildOpenAIOutputTokenDetails(chunk.usage as OpenAI.Chat.Completions.CompletionUsage),
    };
  }
```

Note: `chunk.usage` on `ChatCompletionChunk` is typed slightly differently in some SDK versions; cast to `CompletionUsage` when calling the helpers.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/llm/providers/openai-adapter.ts
git commit -m "fix(core/openai): parse cache token details from streaming chunks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Anthropic Adapter — Parse Details in `parseAnthropicResponse`

**Files:**
- Modify: `packages/core/src/llm/providers/anthropic-adapter.ts:58-81`

- [ ] **Step 1: Add a helper to build details from Anthropic usage**

Add this helper above `parseAnthropicResponse` (after `convertToAnthropicTools`):

```typescript
function buildAnthropicInputTokenDetails(usage: Anthropic.Message['usage']) {
  if (!usage?.input_token_details) return undefined;
  const cacheRead = usage.input_token_details.cache_read_tokens ?? 0;
  const cacheWrite = usage.input_token_details.cache_creation_tokens ?? 0;
  return {
    noCacheTokens: Math.max(0, usage.input_tokens - cacheRead - cacheWrite),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

function buildAnthropicOutputTokenDetails(usage: Anthropic.Message['usage']) {
  if (!usage?.output_token_details) return undefined;
  const reasoning = usage.output_token_details.reasoning_tokens ?? 0;
  return {
    textTokens: Math.max(0, usage.output_tokens - reasoning),
    reasoningTokens: reasoning,
  };
}
```

- [ ] **Step 2: Update `parseAnthropicResponse` to include details**

Replace the `usage` block with:

```typescript
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      inputTokenDetails: buildAnthropicInputTokenDetails(response.usage),
      outputTokenDetails: buildAnthropicOutputTokenDetails(response.usage),
    },
  };
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/llm/providers/anthropic-adapter.ts
git commit -m "fix(core/anthropic): parse cache token details from non-streaming response

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Anthropic Adapter — Parse Details in `parseAnthropicStreamEvent`

**Files:**
- Modify: `packages/core/src/llm/providers/anthropic-adapter.ts:100-117`

- [ ] **Step 1: Update `message_start` usage chunk**

Replace the `message_start` usage yield with:

```typescript
  } else if (event.type === 'message_start') {
    const message = event.message as any;
    if (message?.usage) {
      yield {
        type: 'usage',
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
        totalTokens: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0),
        inputTokenDetails: buildAnthropicInputTokenDetails(message.usage),
        outputTokenDetails: buildAnthropicOutputTokenDetails(message.usage),
      };
    }
  }
```

- [ ] **Step 2: Update `message_delta` usage chunk**

Replace the `message_delta` usage yield with:

```typescript
  } else if (event.type === 'message_delta' && event.usage) {
    yield {
      type: 'usage',
      inputTokens: 0,
      outputTokens: event.usage.output_tokens,
      totalTokens: event.usage.output_tokens,
      outputTokenDetails: buildAnthropicOutputTokenDetails(event.usage as Anthropic.Message['usage']),
    };
  }
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/llm/providers/anthropic-adapter.ts
git commit -m "fix(core/anthropic): parse cache token details from streaming events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: StreamCollector — Preserve Details

**Files:**
- Modify: `packages/core/src/llm/stream-collector.ts:21-27`

- [ ] **Step 1: Update the usage branch in `feed`**

Replace:

```typescript
    } else if (chunk.type === 'usage') {
      this.usage = {
        inputTokens: chunk.inputTokens,
        outputTokens: chunk.outputTokens,
        totalTokens: chunk.totalTokens,
      };
```

with:

```typescript
    } else if (chunk.type === 'usage') {
      this.usage = {
        inputTokens: chunk.inputTokens,
        outputTokens: chunk.outputTokens,
        totalTokens: chunk.totalTokens,
        inputTokenDetails: chunk.inputTokenDetails,
        outputTokenDetails: chunk.outputTokenDetails,
      };
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/llm/stream-collector.ts
git commit -m "fix(core): preserve input/output token details in stream collector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ReactLoop — Reuse `token-usage.ts`

**Files:**
- Modify: `packages/core/src/plugins/loop/react/index.ts`

- [ ] **Step 1: Add the import**

At the top of the file, add:

```typescript
import { emptyUsage, addUsage } from '../../token-usage.js';
```

- [ ] **Step 2: Replace initial usage and remove local helper**

In `run()`, change:

```typescript
let usage = this.zeroUsage();
```

to:

```typescript
let usage = emptyUsage();
```

And change:

```typescript
usage = this.addUsage(usage, reasonResult.usage);
```

to:

```typescript
usage = addUsage(usage, reasonResult.usage);
```

- [ ] **Step 3: Delete the local `zeroUsage` and `addUsage` methods**

Remove these two methods from the class:

```typescript
  private zeroUsage(): LanguageModelUsage { ... }
  private addUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage { ... }
```

Also remove the `LanguageModelUsage` import if it is no longer used (it is still used in the method signature of the deleted `addUsage`, so after deletion it may be unused — check and remove if the linter/typecheck flags it).

- [ ] **Step 4: Type-check**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/loop/react/index.ts
git commit -m "fix(core/react-loop): reuse token-usage addUsage to accumulate details correctly

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: OpenAI Provider Tests

**Files:**
- Modify: `packages/core/tests/llm/providers/openai.test.ts`

- [ ] **Step 1: Add non-streaming cache details test**

Insert after the existing `it('should generate text', ...)` test:

```typescript
  it('should parse prompt token details', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          content: 'Hello!',
          tool_calls: [],
        },
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 30 },
      },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const result = await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });

    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.inputTokenDetails).toEqual({ noCacheTokens: 70, cacheReadTokens: 30 });
  });
```

- [ ] **Step 2: Add streaming cache details test**

Insert after the existing `it('should stream text chunks', ...)` test:

```typescript
  it('should emit usage chunk with prompt token details', async () => {
    async function* mockStream() {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 4 } } };
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const chunks: any[] = [];
    for await (const chunk of openaiProvider.stream({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })) {
      chunks.push(chunk);
    }

    const usageChunks = chunks.filter(c => c.type === 'usage');
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0].inputTokenDetails).toEqual({ noCacheTokens: 6, cacheReadTokens: 4 });
  });
```

- [ ] **Step 3: Run the OpenAI tests**

Run: `pnpm --filter rem-agent-core test tests/llm/providers/openai.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/llm/providers/openai.test.ts
git commit -m "test(core/openai): assert cache token details parsing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Anthropic Provider Tests

**Files:**
- Modify: `packages/core/tests/llm/providers/anthropic.test.ts`

- [ ] **Step 1: Add non-streaming cache details test**

Insert after the existing `it('should generate text', ...)` test:

```typescript
  it('should parse input token details', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello!' }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_token_details: {
          cache_read_tokens: 40,
          cache_creation_tokens: 10,
        },
      },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const result = await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });

    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.inputTokenDetails).toEqual({
      noCacheTokens: 50,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
    });
  });
```

- [ ] **Step 2: Add streaming cache details test**

Insert after the existing `it('should stream text chunks', ...)` test:

```typescript
  it('should emit usage chunks with token details', async () => {
    async function* mockStream() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield {
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 50,
            output_tokens: 0,
            input_token_details: { cache_read_tokens: 20, cache_creation_tokens: 5 },
          },
        },
      };
      yield {
        type: 'message_delta',
        usage: { output_tokens: 10 },
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
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })) {
      chunks.push(chunk);
    }

    const usageChunks = chunks.filter(c => c.type === 'usage');
    expect(usageChunks).toHaveLength(2);
    expect(usageChunks[0].inputTokenDetails).toEqual({
      noCacheTokens: 25,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
    });
    expect(usageChunks[1].outputTokens).toBe(10);
  });
```

- [ ] **Step 3: Run the Anthropic tests**

Run: `pnpm --filter rem-agent-core test tests/llm/providers/anthropic.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/llm/providers/anthropic.test.ts
git commit -m "test(core/anthropic): assert cache token details parsing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: StreamCollector Tests

**Files:**
- Create: `packages/core/tests/llm/stream-collector.test.ts`

- [ ] **Step 1: Create the test file**

Create `packages/core/tests/llm/stream-collector.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { StreamCollector } from '../../src/llm/stream-collector.js';

describe('StreamCollector', () => {
  it('preserves input and output token details from usage chunks', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'text', text: 'hello' });
    collector.feed({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      inputTokenDetails: { noCacheTokens: 70, cacheReadTokens: 30 },
      outputTokenDetails: { textTokens: 15, reasoningTokens: 5 },
    });

    const result = collector.result();
    expect(result.usage.inputTokenDetails).toEqual({ noCacheTokens: 70, cacheReadTokens: 30 });
    expect(result.usage.outputTokenDetails).toEqual({ textTokens: 15, reasoningTokens: 5 });
  });

  it('overwrites details when multiple usage chunks are fed', () => {
    const collector = new StreamCollector();
    collector.feed({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0 },
    });
    collector.feed({
      type: 'usage',
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 10 },
    });

    const result = collector.result();
    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.inputTokenDetails).toEqual({ noCacheTokens: 10, cacheReadTokens: 10 });
  });
});
```

- [ ] **Step 2: Run the StreamCollector tests**

Run: `pnpm --filter rem-agent-core test tests/llm/stream-collector.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/llm/stream-collector.test.ts
git commit -m "test(core): add stream-collector tests for token details

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: ReactLoop Tests

**Files:**
- Modify: `packages/core/tests/plugins/loop/react/react-loop.test.ts`

- [ ] **Step 1: Add multi-step detail accumulation test**

Append a new test inside the existing `describe('ReactLoop', ...)` block:

```typescript
  it('accumulates input token details across multiple steps', async () => {
    const msgs: any[] = [];
    const ctx = {
      liveState: new AgentLiveState(),
      system: 'You are Rem.',
      messages: msgs,
      addMessage: () => { const m: any = { id: 'a', role: 'assistant', content: [] }; msgs.push(m); return m; },
      appendContent: () => {},
      reason: vi.fn()
        .mockResolvedValueOnce({
          text: 'step 1',
          toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: {} }],
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            inputTokenDetails: { noCacheTokens: 8, cacheReadTokens: 2 },
          },
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          text: 'step 2',
          toolCalls: [],
          usage: {
            inputTokens: 20,
            outputTokens: 10,
            totalTokens: 30,
            inputTokenDetails: { noCacheTokens: 15, cacheReadTokens: 5 },
          },
          finishReason: 'stop',
        }),
      execute: vi.fn(async () => [{ toolCallId: 'tc-1', toolName: 'echo', output: 'echoed' }]),
      emit: () => {},
    } as any;

    const loop = new ReactLoop();
    const result = await loop.run(ctx);

    expect(result.usage.inputTokens).toBe(30);
    expect(result.usage.inputTokenDetails).toEqual({ noCacheTokens: 23, cacheReadTokens: 7 });
  });
```

- [ ] **Step 2: Run the ReactLoop tests**

Run: `pnpm --filter rem-agent-core test tests/plugins/loop/react/react-loop.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/plugins/loop/react/react-loop.test.ts
git commit -m "test(core/react-loop): assert multi-step token detail accumulation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Full Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: no errors across all packages.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 3: Review the diff**

Run: `git log --oneline <base>..HEAD` and `git diff --stat`
Expected: changes limited to the files listed in the File Structure section.

- [ ] **Step 4: Final commit (if any uncommitted changes remain)**

```bash
git add -A
git commit -m "fix(core): usage cache details now parsed, preserved, and accumulated

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every design section maps to a task: OpenAI details (Tasks 1-2), Anthropic details (Tasks 3-4), StreamCollector (Task 5), ReactLoop (Task 6), tests (Tasks 7-10), verification (Task 11).
- [ ] **Placeholder scan:** No TBD, TODO, or vague instructions remain. Each step includes concrete code or exact commands.
- [ ] **Type consistency:** `inputTokenDetails` / `outputTokenDetails` shapes match `LanguageModelUsage` and `StreamChunk` types from `packages/core/src/types.ts` and `packages/core/src/llm/types.ts`.
