# Fix Usage Cache Details Always Zero

## Status

Approved design, ready for implementation plan.

## Problem

The web UI token stats badge shows `cache 0/0` even when the upstream LLM API returns cache token details. The root cause is a broken chain from the provider response to the final aggregated usage: adapters do not parse cache-related token details, the stream collector drops them, and the ReactLoop accumulates usage incorrectly.

## Goals

- Parse `inputTokenDetails` / `outputTokenDetails` from OpenAI and Anthropic responses.
- Preserve details through streaming collection.
- Fix multi-step usage accumulation in `ReactLoop`.
- Keep the existing `LanguageModelUsage` / `StreamChunk` types unchanged.

## Non-Goals

- Change how the UI displays cache stats (it already reads `inputTokenDetails`).
- Add new providers or new token-detail categories beyond what OpenAI/Anthropic return today.
- Refactor the provider abstraction beyond the minimal changes required.

## Design

### 1. OpenAI Adapter

File: `packages/core/src/llm/providers/openai-adapter.ts`

Both `parseOpenAIResponse` and `parseOpenAIChunk` must extract details from the `usage` object.

Mapping:

| Our field | OpenAI source |
|---|---|
| `inputTokenDetails.cacheReadTokens` | `usage.prompt_tokens_details.cached_tokens` |
| `inputTokenDetails.noCacheTokens` | `usage.prompt_tokens - (usage.prompt_tokens_details.cached_tokens ?? 0)` |
| `inputTokenDetails.cacheWriteTokens` | `undefined` (OpenAI does not expose write tokens separately) |
| `outputTokenDetails.textTokens` | `usage.completion_tokens - (usage.completion_tokens_details?.reasoning_tokens ?? 0)` |
| `outputTokenDetails.reasoningTokens` | `usage.completion_tokens_details.reasoning_tokens` |

All detail fields are optional; if upstream data is absent the adapter omits the field rather than forcing `0`.

### 2. Anthropic Adapter

File: `packages/core/src/llm/providers/anthropic-adapter.ts`

Both `parseAnthropicResponse` and `parseAnthropicStreamEvent` must extract details.

Mapping:

| Our field | Anthropic source |
|---|---|
| `inputTokenDetails.cacheReadTokens` | `usage.cache_read_input_tokens` |
| `inputTokenDetails.cacheWriteTokens` | `usage.cache_creation_input_tokens` |
| `inputTokenDetails.noCacheTokens` | `usage.input_tokens - cache_read - cache_creation` |
| `outputTokenDetails.reasoningTokens` | `usage.output_tokens_details.thinking_tokens` |
| `outputTokenDetails.textTokens` | `usage.output_tokens - thinking_tokens` |

### 3. Stream Collector

File: `packages/core/src/llm/stream-collector.ts`

When `feed` receives a `usage` chunk, it must copy `inputTokenDetails` and `outputTokenDetails` into `this.usage` instead of only keeping the top-level token counts.

### 4. ReactLoop

File: `packages/core/src/plugins/loop/react/index.ts`

Remove the local `zeroUsage()` and `addUsage()` helpers and reuse the existing implementations from `packages/core/src/token-usage.ts`:

```typescript
import { emptyUsage, addUsage } from '../../token-usage.js';
```

- Initial usage: `emptyUsage()`
- Per-step accumulation: `addUsage(usage, reasonResult.usage)`

This eliminates duplicated accumulation logic and ensures details are added correctly.

### 5. Testing

The following tests must be added or updated to prevent regression.

#### 5.1 OpenAI Provider Tests

File: `packages/core/tests/llm/providers/openai.test.ts`

Add two new test cases:

1. **`generate()` parses prompt token details**
   - Mock response includes `usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30 } }`.
   - Assert `result.usage.inputTokenDetails` equals `{ noCacheTokens: 70, cacheReadTokens: 30 }` (write omitted).
2. **`stream()` emits usage chunk with details**
   - Last stream chunk includes `usage` with `prompt_tokens_details.cached_tokens`.
   - Assert the yielded `usage` chunk carries `inputTokenDetails.cacheReadTokens` equal to the mocked value.

#### 5.2 Anthropic Provider Tests

File: `packages/core/tests/llm/providers/anthropic.test.ts`

Add two new test cases:

1. **`generate()` parses input token details**
   - Mock response includes `usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 }`.
   - Assert `result.usage.inputTokenDetails` equals `{ noCacheTokens: 50, cacheReadTokens: 40, cacheWriteTokens: 10 }`.
2. **`stream()` emits details from `message_start` and `message_delta`**
   - Yield a `message_start` event with `cache_read_input_tokens` / `cache_creation_input_tokens` and a `message_delta` event with output tokens.
   - Assert aggregated usage chunks carry the correct `inputTokenDetails`.

#### 5.3 Stream Collector Tests

File: `packages/core/tests/llm/stream-collector.test.ts` (new file)

Add focused tests:

1. **Collect usage chunk with details**
   - Feed a `usage` chunk that includes `inputTokenDetails` and `outputTokenDetails`.
   - Assert `collector.result().usage` preserves both detail objects.
2. **Multiple usage chunks accumulate top-level counts but last details win**
   - Confirm behavior matches current semantics: top-level tokens are overwritten by the latest chunk, details are also overwritten (this matches how OpenAI/Anthropic emit a single final usage chunk).

#### 5.4 ReactLoop Tests

File: `packages/core/tests/plugins/loop/react/index.test.ts` (create if missing)

Add one test:

1. **Multi-step usage accumulates details**
   - Mock `ctx.reason()` to return usage with `inputTokenDetails` twice.
   - Assert the final `LoopResult.usage.inputTokenDetails` equals the sum of both steps (including `cacheWriteTokens: 0` because `addUsage` normalizes missing fields to zero).
   - This directly guards against the previous bug where `inputTokenDetails` only kept the first step and `outputTokenDetails` only kept the last.

#### 5.5 Existing Coverage

- `packages/core/tests/token-usage.test.ts` already exercises `addUsage` and `computeCacheStats` with details; keep it green.
- Run full suite after changes: `pnpm typecheck && pnpm test`.

## Data Flow After Fix

```
API response
  → adapter parses top-level tokens + details
  → StreamChunk (type: 'usage') carries details
  → StreamCollector stores details in GenerateResult.usage
  → reason() returns LanguageModelUsage with details
  → ReactLoop.addUsage() accumulates details across steps
  → run-agent persists / publishes aggregated usage
  → UI TokenStatsBadge displays cache read/write via computeCacheStats()
```

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Provider SDK types may not expose `prompt_tokens_details` in all versions | Use optional chaining and `as any` only when necessary; fallback to omitting details. |
| `noCacheTokens` derived value could become negative if API math is inconsistent | Clamp to `Math.max(0, ...)` during calculation. |
| Breaking existing tests that assert exact `usage` shape | Update those tests to expect details only when mock data provides them. |

## Affected Files

- `packages/core/src/llm/providers/openai-adapter.ts`
- `packages/core/src/llm/providers/anthropic-adapter.ts`
- `packages/core/src/llm/stream-collector.ts`
- `packages/core/src/plugins/loop/react/index.ts`
- `packages/core/tests/llm/providers/openai.test.ts`
- `packages/core/tests/llm/providers/anthropic.test.ts`
- `packages/core/tests/llm/stream-collector.test.ts` (new)
- `packages/core/tests/plugins/loop/react/index.test.ts` (new)
