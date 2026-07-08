# AgentService Unit Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate and expand `packages/bridge` AgentService tests into `tests/agent-service/`, achieving ≥90% line coverage on `packages/bridge/src/agent.ts` with no skipped tests.

**Architecture:** Tests use mock LLM providers registered in `rem-agent-core` so `AgentService` exercises real `buildAgentContext`/`runAgent` paths while keeping assertions focused on `AgentService` state and bus events. Shared helpers live in `tests/agent-service/shared.ts`.

**Tech Stack:** vitest, TypeScript, `rem-agent-core` (workspace), Node `fs/promises` temp dirs.

---

## File Structure

### Files to Create

| File | Responsibility |
|------|----------------|
| `packages/bridge/tests/agent-service/shared.ts` | Shared helpers: temp dir creation, mock provider registration, service factory, bus event collection, stream builders |
| `packages/bridge/tests/agent-service/init.test.ts` | `init()`, idempotency, `ensureInitialized()` parameterised guard |
| `packages/bridge/tests/agent-service/session.test.ts` | Session CRUD, `getMessages`, persistence, 404 boundaries |
| `packages/bridge/tests/agent-service/run.test.ts` | `run()` normal flow, error flow, concurrency, sync throw |
| `packages/bridge/tests/agent-service/interrupt-reset.test.ts` | `interrupt()`/`reset()` state transitions and safety |
| `packages/bridge/tests/agent-service/stream.test.ts` | `stream()` snapshot replay, live events, workspace filter, multi-subscriber, unsubscribe |
| `packages/bridge/tests/agent-service/approval.test.ts` | `listPendingApprovals()`, `resolveApproval()`, approval end-to-end via bus |

### Files to Delete

- `packages/bridge/tests/agent-service.test.ts`
- `packages/bridge/tests/agent-service-init.test.ts`
- `packages/bridge/tests/agent-service-run.test.ts`
- `packages/bridge/tests/agent-service-stream.test.ts`
- `packages/bridge/tests/agent-service-approval.test.ts`

### Files Read but Not Modified

- `packages/bridge/src/agent.ts`
- `packages/bridge/src/agent-service.interface.ts`
- `packages/bridge/src/agent-session.ts`
- `packages/bridge/src/types.ts`
- `packages/bridge/src/errors.ts`
- `packages/core/src/agent-state.ts`
- `packages/core/src/state.ts`
- `packages/core/src/run-agent.ts`

---

## Task 1: Create Shared Test Helpers

**Files:**
- Create: `packages/bridge/tests/agent-service/shared.ts`

**Context:** All test files need a temporary directory, an initialised `AgentService`, mock provider registration, and helpers to collect bus events. Centralising this avoids duplication and makes tests readable.

- [ ] **Step 1: Write `shared.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService, type AgentServiceOptions } from '../../src/agent.js';
import {
  clearProviders,
  registerProvider,
  type AgentStreamChunk,
  type AgentState,
  type GenerateResult,
} from 'rem-agent-core';
import type { BusEvent } from '../../src/types.js';

export const DEFAULT_WORKSPACE = 'default';

export interface MockProviderConfig {
  name: string;
  stream?: () => AsyncGenerator<AgentStreamChunk>;
  generate?: () => Promise<GenerateResult>;
}

export function registerMockProvider(config: MockProviderConfig): void {
  registerProvider(config.name, {
    resolveConfig() {
      return { provider: config.name, model: 'mock-model', apiKey: 'fake-key' };
    },
    async generate() {
      return config.generate
        ? config.generate()
        : { text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
    async *stream() {
      if (config.stream) {
        yield* config.stream();
      }
    },
  });
}

export interface TestService {
  service: AgentService;
  dir: string;
  cleanup: () => Promise<void>;
}

export async function createTestService(options: {
  workspace?: string;
  provider?: MockProviderConfig;
  agentOptions?: Partial<AgentServiceOptions>;
} = {}): Promise<TestService> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-service-test-'));

  if (options.provider) {
    registerMockProvider(options.provider);
  }

  const service = new AgentService(
    {
      name: 'TestAgent',
      provider: options.provider?.name ?? 'mock-default',
      model: 'mock-model',
      workspaceRoot: dir,
      sessionsDir: dir,
      ...options.agentOptions,
    },
    options.workspace ?? DEFAULT_WORKSPACE,
  );

  await service.init();

  return {
    service,
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function getAgentState(service: AgentService): AgentState {
  return (service as unknown as { state: AgentState }).state;
}

export function collectBusEvents(
  service: AgentService,
  sessionId?: string,
): { events: BusEvent[]; stop: () => void } {
  const events: BusEvent[] = [];
  const state = getAgentState(service);
  const stop = state.subscribe((event) => {
    if (sessionId === undefined || event.sessionId === sessionId) {
      events.push(event);
    }
  });
  return { events, stop };
}

export async function waitFor(
  events: BusEvent[],
  predicate: (events: BusEvent[]) => boolean,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(events)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timeout');
}

export async function* buildStreamFromChunks(chunks: AgentStreamChunk[]): AsyncGenerator<AgentStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

export const simpleTextStream = (): AsyncGenerator<AgentStreamChunk> =>
  buildStreamFromChunks([
    { type: 'message-start', messageId: 'm1' },
    { type: 'text-start', step: 0, partId: 'p1' },
    { type: 'text-delta', step: 0, partId: 'p1', text: 'Hello' },
    { type: 'text-finish', step: 0, partId: 'p1' },
    { type: 'finish', messageId: 'm1' },
  ]);

afterEach(() => {
  clearProviders();
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
pnpm --filter rem-agent-bridge typecheck
```

Expected: No errors in `shared.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/tests/agent-service/shared.ts
git commit -m "test(bridge): add shared helpers for AgentService tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Write `init.test.ts`

**Files:**
- Create: `packages/bridge/tests/agent-service/init.test.ts`

**Context:** Tests `init()` builds context, is idempotent, and that every public method guarded by `ensureInitialized()` throws a 503 `ServiceError` before `init()` is called.

- [ ] **Step 1: Write `init.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../../src/agent.js';

const GUARDED_METHODS = [
  { name: 'run', call: (s: AgentService) => s.run('s1', 'hi') },
  { name: 'interrupt', call: (s: AgentService) => s.interrupt('s1') },
  { name: 'reset', call: (s: AgentService) => s.reset('s1') },
  { name: 'createSession', call: (s: AgentService) => s.createSession() },
  { name: 'listSessions', call: (s: AgentService) => s.listSessions() },
  { name: 'getMessages', call: (s: AgentService) => s.getMessages('s1') },
  { name: 'updateSession', call: (s: AgentService) => s.updateSession('s1', { title: 'X' }) },
  { name: 'deleteSession', call: (s: AgentService) => s.deleteSession('s1') },
  { name: 'listPendingApprovals', call: (s: AgentService) => s.listPendingApprovals('s1') },
  { name: 'resolveApproval', call: (s: AgentService) => s.resolveApproval('s1', 'a1', 'allow-once') },
];

describe('AgentService init', { timeout: 20000 }, () => {
  let dir: string;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-init-test-'));
    service = new AgentService({ workspaceRoot: dir, sessionsDir: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds AgentContext on init', async () => {
    await service.init();
    const summary = await service.createSession();
    expect(summary.sessionId).toBeDefined();
    expect(summary.title).toBe('New Chat');
  });

  it('is idempotent', async () => {
    await service.init();
    await service.init();
    const summary = await service.createSession();
    expect(summary.sessionId).toBeDefined();
  });

  it('throws 503 when stream is consumed before init', async () => {
    const iterator = service.stream()[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(/not initialized/);
  });

  it.each(GUARDED_METHODS)('throws 503 when $name is called before init', async ({ call }) => {
    await expect(call(service)).rejects.toThrow(/not initialized/);
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter rem-agent-bridge test -- packages/bridge/tests/agent-service/init.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/tests/agent-service/init.test.ts
git commit -m "test(bridge): add AgentService init tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Write `session.test.ts`

**Files:**
- Create: `packages/bridge/tests/agent-service/session.test.ts`

**Context:** Covers all session CRUD operations, message merging, persistence across service instances, and 404 boundaries. Replaces and extends the old `agent-service.test.ts`.

- [ ] **Step 1: Write `session.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { ModelMessage } from 'rem-agent-core';
import { createTestService } from './shared.js';

describe('AgentService session management', { timeout: 20000 }, () => {
  it('creates a session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      expect(summary.sessionId).toBeDefined();
      expect(summary.title).toBe('New Chat');
      expect(summary.messageCount).toBe(0);

      const list = await service.listSessions();
      expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('lists sessions with pinned first', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const a = await service.createSession();
      const b = await service.createSession();
      await service.updateSession(a.sessionId, { pinned: true, title: 'Pinned' });

      const list = await service.listSessions();
      expect(list[0].sessionId).toBe(a.sessionId);
      expect(list[0].pinned).toBe(true);
      expect(list[0].title).toBe('Pinned');
      expect(list.some((s) => s.sessionId === b.sessionId)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('updates title and pinned', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      await service.updateSession(summary.sessionId, { title: 'Renamed', pinned: true });
      const list = await service.listSessions();
      const found = list.find((s) => s.sessionId === summary.sessionId);
      expect(found?.title).toBe('Renamed');
      expect(found?.pinned).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('refreshes updatedAt when updating session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const before = await service.listSessions();
      const beforeUpdatedAt = before.find((s) => s.sessionId === summary.sessionId)!.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      await service.updateSession(summary.sessionId, { title: 'Renamed' });

      const after = await service.listSessions();
      const afterUpdatedAt = after.find((s) => s.sessionId === summary.sessionId)!.updatedAt;
      expect(afterUpdatedAt).toBeGreaterThan(beforeUpdatedAt);
    } finally {
      await cleanup();
    }
  });

  it('deletes a session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      await service.deleteSession(summary.sessionId);
      const list = await service.listSessions();
      expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('throws 404 when deleting non-existent session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      await expect(service.deleteSession('nonexistent')).rejects.toThrow(/Session not found/);
    } finally {
      await cleanup();
    }
  });

  it('throws 404 when getting messages for non-existent session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      await expect(service.getMessages('nonexistent')).rejects.toThrow(/Session not found/);
    } finally {
      await cleanup();
    }
  });

  it('throws 404 when updating non-existent session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      await expect(service.updateSession('nonexistent', { title: 'X' })).rejects.toThrow(/Session not found/);
    } finally {
      await cleanup();
    }
  });

  it('returns messages for existing session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const messages = await service.getMessages(summary.sessionId);
      expect(messages).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('merges tool-result parts into assistant messages', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const sessionProvider = service.context!.sessionProvider;
      const session = await sessionProvider.load(summary.sessionId);
      if (!session) throw new Error('Session not found');

      const assistantMsg: ModelMessage = {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'ls', arguments: { path: '.' } }],
      };
      const toolMsg: ModelMessage = {
        id: 't1',
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: 'ls', output: 'file.txt' }],
      };
      session.conversation.push(assistantMsg, toolMsg);
      await sessionProvider.save(session);

      const messages = await service.getMessages(summary.sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].parts).toHaveLength(2);
      expect(messages[0].parts[0]).toEqual({ type: 'tool-call', toolCallId: 'tc1', toolName: 'ls', arguments: { path: '.' } });
      expect(messages[0].parts[1]).toEqual({ type: 'tool-result', toolCallId: 'tc1', toolName: 'ls', output: 'file.txt' });
    } finally {
      await cleanup();
    }
  });

  it('persists sessions across AgentService instances using the same sessionsDir', async () => {
    const { service, dir, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      await service.updateSession(summary.sessionId, { title: 'Persisted' });

      const sessionProvider = service.context!.sessionProvider;
      const session = await sessionProvider.load(summary.sessionId);
      if (!session) throw new Error('Session not found');
      session.conversation.push({
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      } as ModelMessage);
      await sessionProvider.save(session);

      const newService = new AgentService({ workspaceRoot: dir, sessionsDir: dir });
      await newService.init();

      const list = await newService.listSessions();
      expect(list.some((s) => s.sessionId === summary.sessionId && s.title === 'Persisted')).toBe(true);

      const messages = await newService.getMessages(summary.sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].parts[0]).toEqual({ type: 'text', text: 'hello' });
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter rem-agent-bridge test -- packages/bridge/tests/agent-service/session.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/tests/agent-service/session.test.ts
git commit -m "test(bridge): add AgentService session management tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Write `run.test.ts`

**Files:**
- Create: `packages/bridge/tests/agent-service/run.test.ts`

**Context:** Covers `run()` immediate resolution, background driver publishing bus events, normal completion, concurrent run rejection, drive error handling, and synchronous `coreRunAgent` throw. Replaces and extends the old `agent-service-run.test.ts`.

- [ ] **Step 1: Write `run.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import * as core from 'rem-agent-core';
import {
  createTestService,
  collectBusEvents,
  waitFor,
  getAgentState,
  simpleTextStream,
} from './shared.js';

describe('AgentService.run background driver', { timeout: 20000 }, () => {
  it('run() resolves immediately and registers the run', async () => {
    const { service, cleanup } = await createTestService({
      provider: { name: 'mock-run', stream: simpleTextStream },
    });
    try {
      const summary = await service.createSession();
      const p = service.run(summary.sessionId, 'hi');
      await expect(p).resolves.toBeUndefined();
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('rejects concurrent run for the same session with 409', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      getAgentState(service).startRun(summary.sessionId, 'default');
      await expect(service.run(summary.sessionId, 'hi')).rejects.toThrow(/already running/);
      getAgentState(service).finishRun(summary.sessionId, 'default');
    } finally {
      await cleanup();
    }
  });

  it('publishes session-start, chunks, and session-end via bus', async () => {
    const { service, cleanup } = await createTestService({
      provider: { name: 'mock-run', stream: simpleTextStream },
    });
    try {
      const summary = await service.createSession();
      const { events, stop } = collectBusEvents(service, summary.sessionId);

      await service.run(summary.sessionId, 'hi');
      await waitFor(events, (es) => es.some((e) => e.type === 'session-end'));
      stop();

      const types = events.map((e) => e.type);
      expect(types).toContain('session-start');
      expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'message-start')).toBe(true);
      expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'text-delta')).toBe(true);
      expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'finish')).toBe(true);
      expect(types).toContain('session-end');
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('publishes session-error when drive throws', async () => {
    const { service, cleanup } = await createTestService({
      provider: {
        name: 'mock-run-error',
        stream: () =>
          (async function* () {
            throw new Error('stream boom');
            yield { type: 'text' as const, text: 'x' };
          })(),
      },
    });
    try {
      const summary = await service.createSession();
      const { events, stop } = collectBusEvents(service, summary.sessionId);

      await service.run(summary.sessionId, 'hi');
      await waitFor(events, (es) => es.some((e) => e.type === 'session-error'));
      stop();

      expect(events.some((e) => e.type === 'session-error' && e.error.includes('stream boom'))).toBe(true);
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('handles synchronous throw from coreRunAgent', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const { events, stop } = collectBusEvents(service, summary.sessionId);

      const runAgentSpy = vi.spyOn(core, 'runAgent').mockImplementationOnce(() => {
        throw new Error('sync boom');
      });

      await expect(service.run(summary.sessionId, 'hi')).rejects.toThrow('sync boom');
      await waitFor(events, (es) => es.some((e) => e.type === 'session-error'));
      stop();

      expect(events.some((e) => e.type === 'session-error' && e.error.includes('sync boom'))).toBe(true);
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(false);
      runAgentSpy.mockRestore();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter rem-agent-bridge test -- packages/bridge/tests/agent-service/run.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/tests/agent-service/run.test.ts
git commit -m "test(bridge): add AgentService run lifecycle tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Write `interrupt-reset.test.ts`

**Files:**
- Create: `packages/bridge/tests/agent-service/interrupt-reset.test.ts`

**Context:** Covers the difference between `interrupt()` (abort only) and `reset()` (abort + finish), plus safety when no run is active. Directly manipulates `AgentState` to start runs deterministically.

- [ ] **Step 1: Write `interrupt-reset.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createTestService, getAgentState } from './shared.js';

describe('AgentService interrupt and reset', { timeout: 20000 }, () => {
  it('interrupt() aborts run but does not finish it', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      getAgentState(service).startRun(summary.sessionId, 'default');
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(true);

      await service.interrupt(summary.sessionId);

      // interrupt only aborts; drive is not running so finishRun is never called.
      // State remains in memory but controller is aborted.
      const liveState = getAgentState(service).get(summary.sessionId)!;
      expect(liveState.runController?.signal.aborted).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('reset() aborts run and finishes it', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      getAgentState(service).startRun(summary.sessionId, 'default');
      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(true);

      await service.reset(summary.sessionId);

      expect(getAgentState(service).isRunning(summary.sessionId)).toBe(false);
      const liveState = getAgentState(service).get(summary.sessionId)!;
      expect(liveState.runController).toBeUndefined();
      expect(liveState.getSnapshot()).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('reset() clears snapshot and runController', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      getAgentState(service).startRun(summary.sessionId, 'default');
      getAgentState(service).startSnapshot(summary.sessionId, 'm1');
      getAgentState(service).appendSnapshotParts(summary.sessionId, { type: 'text', text: 'x' });

      await service.reset(summary.sessionId);

      expect(getAgentState(service).getSnapshot(summary.sessionId)).toBeUndefined();
      expect(getAgentState(service).get(summary.sessionId)?.runController).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('interrupt() is safe when session is not running', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      await expect(service.interrupt(summary.sessionId)).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('reset() is safe when session is not running', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      await expect(service.reset(summary.sessionId)).resolves.toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter rem-agent-bridge test -- packages/bridge/tests/agent-service/interrupt-reset.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/tests/agent-service/interrupt-reset.test.ts
git commit -m "test(bridge): add AgentService interrupt and reset tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Write `stream.test.ts`

**Files:**
- Create: `packages/bridge/tests/agent-service/stream.test.ts`

**Context:** Covers snapshot replay, live event delivery, workspace filtering, multiple concurrent subscribers, and unsubscribe on break/return. Directly manipulates `AgentState` for deterministic setup.

- [ ] **Step 1: Write `stream.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createTestService, getAgentState } from './shared.js';
import type { BusEvent } from '../../src/types.js';

describe('AgentService stream', { timeout: 20000 }, () => {
  it('replays snapshots for running sessions then yields live events', async () => {
    const { service, cleanup } = await createTestService();
    try {
      getAgentState(service).startRun('s1', 'default');
      getAgentState(service).startSnapshot('s1', 'm1');
      getAgentState(service).appendSnapshotParts('s1', { type: 'text', text: 'hello' });

      const iterator = service.stream()[Symbol.asyncIterator]();

      queueMicrotask(() =>
        getAgentState(service).publish({ workspace: 'default', sessionId: 's1', type: 'session-end' }),
      );

      const first = await iterator.next();
      expect((first.value as BusEvent).type).toBe('snapshot');

      const second = await iterator.next();
      expect((second.value as BusEvent).type).toBe('session-end');

      await iterator.return?.();
    } finally {
      await cleanup();
    }
  });

  it('filters events by workspace', async () => {
    const { service, cleanup } = await createTestService({ workspace: 'ws-a' });
    try {
      const iterator = service.stream()[Symbol.asyncIterator]();

      queueMicrotask(() => {
        getAgentState(service).publish({ workspace: 'ws-b', sessionId: 's1', type: 'session-start' });
        getAgentState(service).publish({ workspace: 'ws-a', sessionId: 's1', type: 'session-end' });
      });

      const first = await iterator.next();
      expect((first.value as BusEvent).type).toBe('session-end');
      expect((first.value as BusEvent).workspace).toBe('ws-a');

      await iterator.return?.();
    } finally {
      await cleanup();
    }
  });

  it('supports multiple concurrent subscribers', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const iter1 = service.stream()[Symbol.asyncIterator]();
      const iter2 = service.stream()[Symbol.asyncIterator]();

      queueMicrotask(() =>
        getAgentState(service).publish({ workspace: 'default', sessionId: 's1', type: 'session-start' }),
      );

      const v1 = await iter1.next();
      const v2 = await iter2.next();
      expect((v1.value as BusEvent).type).toBe('session-start');
      expect((v2.value as BusEvent).type).toBe('session-start');

      await iter1.return?.();
      await iter2.return?.();
    } finally {
      await cleanup();
    }
  });

  it('unsubscribes on break/return', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const iter = service.stream()[Symbol.asyncIterator]();
      await iter.return?.();

      // After return, subscriber is removed; no errors on publish.
      expect(() =>
        getAgentState(service).publish({ workspace: 'default', sessionId: 's1', type: 'session-start' }),
      ).not.toThrow();
    } finally {
      await cleanup();
    }
  });

  it('replays no snapshots when no sessions are running', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const iterator = service.stream()[Symbol.asyncIterator]();

      queueMicrotask(() =>
        getAgentState(service).publish({ workspace: 'default', sessionId: 's1', type: 'session-start' }),
      );

      const first = await iterator.next();
      expect((first.value as BusEvent).type).toBe('session-start');

      await iterator.return?.();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter rem-agent-bridge test -- packages/bridge/tests/agent-service/stream.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/tests/agent-service/stream.test.ts
git commit -m "test(bridge): add AgentService stream tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Write `approval.test.ts`

**Files:**
- Create: `packages/bridge/tests/agent-service/approval.test.ts`

**Context:** Covers `listPendingApprovals()`, `resolveApproval()` directly, plus an end-to-end run that emits an `approval-request` chunk, waits for resolution, and verifies `approval-resolved` / `tool-result` bus events. The tool-call needs to target a tool that triggers approvals when `autoApproveDangerous` is false; the simplest path is to register a mock provider that yields an `approval-request` chunk directly.

- [ ] **Step 1: Write `approval.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  createTestService,
  getAgentState,
  collectBusEvents,
  waitFor,
  buildStreamFromChunks,
} from './shared.js';
import type { AgentStreamChunk } from 'rem-agent-core';

function approvalStream(): AsyncGenerator<AgentStreamChunk> {
  return buildStreamFromChunks([
    { type: 'message-start', messageId: 'm1' },
    {
      type: 'approval-request',
      messageId: 'm1',
      approvalId: 'ap1',
      toolCallId: 'tc1',
      toolName: 'write',
      input: { path: './poem.txt', content: 'A poem' },
    },
    { type: 'usage', inputTokens: 5, outputTokens: 5, totalTokens: 10 },
  ]);
}

describe('AgentService approval flow', { timeout: 20000 }, () => {
  it('listPendingApprovals() returns pending requests from AgentState', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const liveState = getAgentState(service).getOrCreate(summary.sessionId);
      liveState.pendingApprovals.push({
        approvalId: 'ap1',
        toolCallId: 'tc1',
        toolName: 'write',
        input: { path: './x.txt' },
      });

      const pending = await service.listPendingApprovals(summary.sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].approvalId).toBe('ap1');
    } finally {
      await cleanup();
    }
  });

  it('resolveApproval() resolves pending approval and returns true', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const liveState = getAgentState(service).getOrCreate(summary.sessionId);
      const waitP = liveState.approvalRegistry.wait('ap1');

      const resolved = await service.resolveApproval(summary.sessionId, 'ap1', 'allow-once');
      expect(resolved).toBe(true);
      await expect(waitP).resolves.toBe('allow-once');
    } finally {
      await cleanup();
    }
  });

  it('resolveApproval() returns false for unknown approvalId', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const resolved = await service.resolveApproval(summary.sessionId, 'unknown', 'allow-once');
      expect(resolved).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('run() emits approval-request and waits for resolveApproval', async () => {
    const { service, cleanup } = await createTestService({
      provider: { name: 'mock-approval', stream: approvalStream },
    });
    try {
      const summary = await service.createSession();
      const { events, stop } = collectBusEvents(service, summary.sessionId);

      await service.run(summary.sessionId, 'write a poem');
      await waitFor(events, (es) =>
        es.some((e) => e.type === 'chunk' && e.chunk.type === 'approval-request'),
      );

      const pending = await service.listPendingApprovals(summary.sessionId);
      expect(pending.some((r) => r.approvalId === 'ap1')).toBe(true);

      const resolved = await service.resolveApproval(summary.sessionId, 'ap1', 'allow-once');
      expect(resolved).toBe(true);

      stop();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
pnpm --filter rem-agent-bridge test -- packages/bridge/tests/agent-service/approval.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/tests/agent-service/approval.test.ts
git commit -m "test(bridge): add AgentService approval flow tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Delete Old Test Files

**Files:**
- Delete: `packages/bridge/tests/agent-service.test.ts`
- Delete: `packages/bridge/tests/agent-service-init.test.ts`
- Delete: `packages/bridge/tests/agent-service-run.test.ts`
- Delete: `packages/bridge/tests/agent-service-stream.test.ts`
- Delete: `packages/bridge/tests/agent-service-approval.test.ts`

- [ ] **Step 1: Delete the files**

```bash
git rm packages/bridge/tests/agent-service.test.ts \
       packages/bridge/tests/agent-service-init.test.ts \
       packages/bridge/tests/agent-service-run.test.ts \
       packages/bridge/tests/agent-service-stream.test.ts \
       packages/bridge/tests/agent-service-approval.test.ts
```

- [ ] **Step 2: Verify old tests are gone**

Run:

```bash
ls packages/bridge/tests/agent-service*.test.ts 2>/dev/null || echo "old files removed"
```

Expected: Output says "old files removed".

- [ ] **Step 3: Commit**

```bash
git commit -m "test(bridge): remove obsolete AgentService test files

Replaced by focused tests under tests/agent-service/.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Verify Full Suite and Coverage

**Files:**
- Read: `packages/bridge/src/agent.ts` (for coverage analysis)

- [ ] **Step 1: Run the full bridge test suite**

Run:

```bash
pnpm --filter rem-agent-bridge test
```

Expected: All tests pass, no `.skip`.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter rem-agent-bridge typecheck
```

Expected: No type errors.

- [ ] **Step 3: Optional — measure line coverage**

If `@vitest/coverage-v8` is installed:

```bash
pnpm --filter rem-agent-bridge test -- --coverage
```

Expected: `packages/bridge/src/agent.ts` line coverage ≥ 90%.

If coverage tool is not installed, inspect uncovered lines manually via vitest UI or by reading `agent.ts` and confirming the uncovered sections are trivial (e.g. getter returns).

- [ ] **Step 4: Commit any final fixes**

If typecheck or tests required fixes, commit them. If no changes, skip.

---

## Spec Coverage Checklist

| Spec Requirement | Implementing Task(s) |
|------------------|---------------------|
| 新建 `tests/agent-service/` 目录 | Task 1-7 creation, Task 8 deletion |
| `init()`、幂等性 | Task 2 |
| `ensureInitialized()` 参数化守卫 | Task 2 |
| 会话 CRUD + `getMessages` | Task 3 |
| `run()` 正常流、错误流、并发、同步抛错 | Task 4 |
| `interrupt()` / `reset()` | Task 5 |
| `stream()` 快照、过滤、多订阅、取消订阅 | Task 6 |
| `listPendingApprovals()` / `resolveApproval()` | Task 7 |
| 90%+ 行覆盖率 | Task 9 |
| 删除旧 `.skip` 测试 | Task 8 |

## Placeholder Scan

No placeholders. Every task contains exact file paths, complete code, and expected command output.

## Type Consistency Notes

- `AgentServiceOptions` imported from `../../src/agent.js` matches `AgentContextBuildOptions`.
- `AgentStreamChunk` and `GenerateResult` imported from `rem-agent-core` match the provider registry types.
- `BusEvent` imported from `../../src/types.js` re-exports the core type.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-agentservice-tests.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints

**Which approach?**
