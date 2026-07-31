# Core Single-Agent System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Core a complete single-Agent Session API that creates sessions, reuses one root `REMAgent` per in-memory Session runtime, persists Agent events, supports interruption, and exposes an async system event stream.

**Architecture:** A small `AgentSystem` facade coordinates a persistence-focused `SessionService`, a uniqueness-focused `SessionRuntimeRegistry`, a lifecycle-focused `SessionRuntime`, and an event-consuming `AgentRunDriver`. Runtime state is process-local and lazily rebuilt from persisted Session history after restart.

**Tech Stack:** TypeScript, pi-ai, pi-agent-core, Vitest, pnpm

---

## File Structure

- Create `packages/core/src/session/runtime.ts`: one Session's root-Agent ownership and run-state transitions.
- Create `packages/core/src/session/runtime-registry.ts`: promise-cached Runtime loading and retry after failure.
- Create `packages/core/src/session/service.ts`: Session persistence and Agent-event persistence.
- Create `packages/core/src/agent/agent-run-driver.ts`: consume one root run and publish system events.
- Create `packages/core/src/system/types.ts`: public inputs, facade contract, and Agent factory type.
- Create `packages/core/src/system/errors.ts`: single-Agent system domain errors.
- Create `packages/core/src/system/event-stream.ts`: BroadcastBus-to-AsyncIterable subscription adapter.
- Create `packages/core/src/system/agent-system.ts`: minimal facade implementation.
- Create `packages/core/src/system/create-agent-system.ts`: public assembly factory.
- Create `packages/core/src/system/index.ts`: public system exports.
- Modify `packages/core/src/agent/bus-events.ts`: define `AgentSystemEvent` and retain `BusEvent` alias.
- Modify `packages/core/src/index.ts`: export the new Core system API.
- Create focused tests for Runtime, Registry, Event Stream, SessionService, and AgentSystem integration.

### Task 1: Session Runtime and Registry

**Files:**

- Create: `packages/core/src/session/runtime.ts`
- Create: `packages/core/src/session/runtime-registry.ts`
- Create: `packages/core/src/system/errors.ts`
- Test: `packages/core/tests/session-runtime.test.ts`
- Test: `packages/core/tests/session-runtime-registry.test.ts`

- [ ] **Step 1: Write failing Runtime ownership/lifecycle tests**

Test that `getOrCreateRootAgent()` calls its factory once, `startRun()` rejects a concurrent run with
`SessionAlreadyRunningError`, `interrupt()` calls the retained Agent, `finishRun()` returns to idle, and
`failRun()` permits a later run.

```typescript
const runtime = new SessionRuntime({ sessionId: 's-1', workspace: 'ws' });
const agent = { interrupt: vi.fn() } as unknown as REMAgent;
const create = vi.fn(() => agent);
expect(runtime.getOrCreateRootAgent(create)).toBe(agent);
expect(runtime.getOrCreateRootAgent(create)).toBe(agent);
expect(create).toHaveBeenCalledTimes(1);
runtime.startRun();
expect(() => runtime.startRun()).toThrow(SessionAlreadyRunningError);
runtime.interrupt();
expect(agent.interrupt).toHaveBeenCalledOnce();
runtime.finishRun();
expect(runtime.status).toBe('idle');
```

- [ ] **Step 2: Write failing Registry concurrency/retry tests**

Use a deferred loader and assert two concurrent `getOrCreate('s-1', loader)` calls resolve to the same
Runtime while loader runs once. Add a rejected-loader case and expect the next call to retry successfully.

- [ ] **Step 3: Run tests and verify missing-module failures**

Run:

```bash
pnpm vitest run packages/core/tests/session-runtime.test.ts packages/core/tests/session-runtime-registry.test.ts
```

Expected: FAIL because the Runtime modules and error do not exist.

- [ ] **Step 4: Implement lifecycle-only SessionRuntime**

Implement `SessionRuntime` with `sessionId`, `workspace`, `status`, optional root Agent, current
AbortController, and these methods:

```typescript
get rootAgent(): REMAgent | undefined;
getOrCreateRootAgent(create: () => REMAgent): REMAgent;
startRun(): AbortSignal;
finishRun(): void;
failRun(): void;
interrupt(): void;
```

`startRun()` accepts `idle` and `error`, rejects only `running`, and creates a fresh controller per run.
`interrupt()` aborts the controller and calls `rootAgent.interrupt()` without changing status itself.

- [ ] **Step 5: Implement promise-cached SessionRuntimeRegistry**

Store pending/resolved Runtime promises. `get()` returns only a synchronously known resolved Runtime;
`getOrCreate()` caches before awaiting and removes the entry if loading rejects. `remove()` forgets the
Runtime without deleting persistent data.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm vitest run packages/core/tests/session-runtime.test.ts packages/core/tests/session-runtime-registry.test.ts
git add packages/core/src/session packages/core/src/system/errors.ts packages/core/tests/session-runtime*.test.ts
git commit -m "feat(core): add session runtime ownership"
```

Expected: focused tests pass and the commit succeeds.

### Task 2: System Events and Async Subscription

**Files:**

- Modify: `packages/core/src/agent/bus-events.ts`
- Create: `packages/core/src/system/event-stream.ts`
- Test: `packages/core/tests/system-event-stream.test.ts`

- [ ] **Step 1: Write failing subscription tests**

Create two iterators from `streamSystemEvents(bus)`, publish one event, and assert both receive it. Abort
one iterator and assert it completes while the other still receives the next event.

```typescript
const bus = new BroadcastBus();
const controller = new AbortController();
const first = streamSystemEvents(bus, controller.signal)[Symbol.asyncIterator]();
const second = streamSystemEvents(bus)[Symbol.asyncIterator]();
const firstNext = first.next();
const secondNext = second.next();
bus.publish({ type: 'session-start', sessionId: 's-1', workspace: 'ws' });
await expect(firstNext).resolves.toMatchObject({ value: { type: 'session-start' } });
await expect(secondNext).resolves.toMatchObject({ value: { type: 'session-start' } });
controller.abort();
await expect(first.next()).resolves.toEqual({ done: true, value: undefined });
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm vitest run packages/core/tests/system-event-stream.test.ts
```

Expected: FAIL because `streamSystemEvents` does not exist.

- [ ] **Step 3: Define the single-Agent AgentSystemEvent surface**

Rename the existing union declaration to `AgentSystemEvent`, keep its currently defined variants for
compatibility, require `agentId` on future Driver-produced chunk events only at construction sites, and add:

```typescript
export type BusEvent = AgentSystemEvent;
```

- [ ] **Step 4: Implement independent async subscriber queues**

`streamSystemEvents(bus, signal)` subscribes on first iteration, queues events per iterator, resolves a
pending read immediately, stops on abort, and always unsubscribes in `finally`. Do not poll or share cursors.

- [ ] **Step 5: Run focused test and commit**

```bash
pnpm vitest run packages/core/tests/system-event-stream.test.ts
git add packages/core/src/agent/bus-events.ts packages/core/src/system/event-stream.ts packages/core/tests/system-event-stream.test.ts
git commit -m "feat(core): expose agent system event stream"
```

### Task 3: Session Event Persistence

**Files:**

- Create: `packages/core/src/session/service.ts`
- Test: `packages/core/tests/session-service.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Use `createFakeAssembly()` and verify:

- `create(workspace)` saves workspace and returns SessionInfo.
- `requireSession(id)` returns the same cached object on repeated calls.
- `persistAgentEvent()` appends `message-persist` messages.
- `usage` appends normalized history and per-message usage.
- `session-title`, `compress-end`, and `finish` update their exact Session fields.

The finish assertion is:

```typescript
await service.persistAgentEvent(session.sessionId, {
  type: 'finish',
  output: { content: 'done', completed: true },
});
expect((await service.requireSession(session.sessionId)).currentTurn).toBe(1);
```

- [ ] **Step 2: Run test and verify missing-module failure**

```bash
pnpm vitest run packages/core/tests/session-service.test.ts
```

- [ ] **Step 3: Implement SessionService**

Compose `AgentSessionManager` for create/list/info conversion and add a loaded Session cache. Implement:

```typescript
create(workspace: string): Promise<SessionInfo>;
get(sessionId: string): Promise<SessionInfo>;
list(workspace: string): Promise<SessionInfo[]>;
requireSession(sessionId: string): Promise<Session>;
persistAgentEvent(sessionId: string, event: REMAgentEvent): Promise<void>;
```

Do not catch persistence errors. Normalize stored usage using the existing token-usage helpers. For
`compress-end`, read the latest archive version. Save Session metadata changes through SessionProvider.

- [ ] **Step 4: Run focused tests, typecheck, and commit**

```bash
pnpm vitest run packages/core/tests/session-service.test.ts
pnpm --filter rem-agent-core typecheck
git add packages/core/src/session/service.ts packages/core/tests/session-service.test.ts
git commit -m "feat(core): persist session agent events"
```

### Task 4: Root Agent Run Driver

**Files:**

- Create: `packages/core/src/agent/agent-run-driver.ts`
- Test: `packages/core/tests/agent-run-driver.test.ts`

- [ ] **Step 1: Write failing Driver routing tests**

Build an `EventQueue<REMAgentEvent>`, push representative persistence, usage, todo, chunk, finish, and error
events, then assert persistence calls, published event order, and Runtime terminal status. Add a persistence
rejection test that expects `runtime.interrupt()`, `runtime.failRun()`, and `session-error`.

- [ ] **Step 2: Run test and verify missing-module failure**

```bash
pnpm vitest run packages/core/tests/agent-run-driver.test.ts
```

- [ ] **Step 3: Implement event routing and activity reduction**

`AgentRunDriver.drive(runtime, agent, events)` serially awaits persistence. Internal `message-persist` is not
published. Usage and todo become dedicated events. Other stream/meta events become chunk events. Finish
persists before `finishRun/session-end`; error invokes `failRun/session-error`. Track only the current
`SessionActivity`, publishing changes for turn, thinking, text, tool-call, compression, and terminal events.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm vitest run packages/core/tests/agent-run-driver.test.ts
git add packages/core/src/agent/agent-run-driver.ts packages/core/tests/agent-run-driver.test.ts
git commit -m "feat(core): drive root agent session runs"
```

### Task 5: Minimal AgentSystem Facade

**Files:**

- Create: `packages/core/src/system/types.ts`
- Create: `packages/core/src/system/agent-system.ts`
- Create: `packages/core/src/system/create-agent-system.ts`
- Create: `packages/core/src/system/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/agent-system.test.ts`

- [ ] **Step 1: Write failing end-to-end system tests**

Using scripted models and fake assembly, test:

1. create Session, subscribe, send, observe `session-start` then `session-end`, and verify two persisted messages.
2. set a second scripted response, send to the same Session, and verify the second model context contains the
   first user/assistant pair plus the second user message.
3. create another Session and verify its model context starts without the first Session history.
4. construct a second AgentSystem over the same DI, send to the existing Session, and verify persisted history
   is loaded into a newly built Runtime.
5. hold a scripted model promise, reject concurrent send, interrupt, await `session-error` or `session-end`, then
   successfully send again.

- [ ] **Step 2: Run test and verify missing API failure**

```bash
pnpm vitest run packages/core/tests/agent-system.test.ts
```

- [ ] **Step 3: Define public types and factory seam**

Define `AgentSystem`, `CreateSessionInput`, `SendMessageInput`, and an internal/public advanced
`RootAgentFactory` with the exact signature:

```typescript
type RootAgentFactory = (params: REMAgentParams) => REMAgent;
```

The optional factory dependency lets tests observe identity without exposing Runtime internals through the
normal facade.

- [ ] **Step 4: Implement AgentSystem orchestration**

`send()` requires the Session, obtains/creates its Runtime, starts the run, lazily creates root Agent with
`agentId: 'root'`, publishes start/pending, calls `agent.run()`, and starts Driver consumption. If synchronous
setup fails, fail the Runtime, publish error, and rethrow. `interrupt()` only touches an already loaded Runtime.

- [ ] **Step 5: Add public factory and exports**

`createAgentSystem(assembly, options?)` constructs the bus, SessionService, Registry, Driver, and facade.
Export the facade, factory, types, errors, Runtime types, and `AgentSystemEvent` from `system/index.ts` and the
package root. Preserve all existing exports.

- [ ] **Step 6: Run focused and full verification**

```bash
pnpm vitest run packages/core/tests/agent-system.test.ts
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core check-structure
pnpm --filter rem-agent-core build
pnpm test
git diff --check
```

Expected: every command passes and all implementation files remain at most 200 lines.

- [ ] **Step 7: Commit the completed facade**

```bash
git add packages/core docs/superpowers/plans/2026-07-31-core-single-agent-system.md
git commit -m "feat(core): add single-agent system facade"
```

Expected: commit succeeds on the user-approved `main` branch and the worktree is clean.
