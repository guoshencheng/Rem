# Config-Driven Multi-Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configuration-driven Organizer/member teams with persistent Delivery scheduling, per-Thread serialized REMAgent runtimes, explicit discussion finishing, budgets, interruption and recovery while preserving the existing single-Agent and one-shot delegation paths.

**Architecture:** ConfigProvider becomes the sole source of Agent and Team definitions; AgentThread stores a configuration `agentId` and SQLite v11 removes AgentProfile persistence. A three-level Runtime model owns process-local execution, while persistent MessageDelivery records and a deterministic Scheduler coordinate cross-Agent work. All Message facts remain single-copy Session entries, and Organizer semantics enter through `send_message` and `finish_discussion` tools.

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, SQLite/better-sqlite3, Vitest, pnpm

---

## File Structure

### Configuration

- Modify `packages/core/src/sdk/config-provider.ts` — add Team and orchestration configuration contracts.
- Modify `packages/core/src/sdk/agent-role.ts` — add strict Agent resolution and resolved Team types.
- Create `packages/core/src/plugins/config/default/team-resolver.ts` — validate and resolve configured teams.
- Modify default config parser, merger and provider to load `teams` and `orchestration`.

### Identity and storage

- Delete `packages/core/src/agent-profile/` and its SQLite Store.
- Modify `session/agent-thread/*` to store `agentId`.
- Replace `schema/agent-ddl.ts`; add `schema/delivery-ddl.ts` and v11 migration.
- Create `orchestration/delivery-{model,store,usecase}.ts`.
- Create `plugins/storage/sqlite/message-delivery-store.ts` and `orchestration-store.ts`.
- Create `session/messages/write-coordinator.ts`; route ordinary and atomic orchestration appends through one Session-keyed lock.

### Runtime and orchestration

- Create `session/agent-thread-runtime.ts` and `agent-thread-runtime-registry.ts`.
- Generalize `session/runtime.ts`; create `orchestration/discussion-runtime.ts` and `discussion-budget.ts`.
- Add `REMAgent.syncTranscript()`.
- Create focused Organizer tool modules and communication-message factory.
- Create `orchestration/scheduler.ts`, `delivery-executor.ts` and `batch-completion.ts`.

### Integration

- Modify `system/create-agent-system.ts`, `system/agent-system.ts`, `system/types.ts` and event types.
- Extend SessionUsecase and AgentThreadUsecase for team creation and read APIs.
- Keep one-shot DelegationRunner, changing only `agentProfileId` to `agentId` inheritance.

---

### Task 1: Parse and Resolve Agent Teams

**Files:**

- Modify: `packages/core/src/sdk/config-provider.ts`
- Modify: `packages/core/src/sdk/agent-role.ts`
- Create: `packages/core/src/plugins/config/default/team-resolver.ts`
- Modify: `packages/core/src/plugins/config/default/config-parser.ts`
- Modify: `packages/core/src/plugins/config/default/config-merger.ts`
- Modify: `packages/core/src/plugins/config/default/default-config-provider.ts`
- Modify: `packages/core/tests/helpers/fake-di.ts`
- Modify: `packages/core/tests/default-config-provider.test.ts`
- Create: `packages/core/tests/team-resolver.test.ts`

- [x] **Step 1: Add failing parser and resolver tests**

Test a valid `engineering` team, workspace override, unknown Team, missing Agent, Organizer duplicated as Member,
duplicate Members and an empty Member list. Assert that `resolveAgent('missing')` throws instead of silently falling
back; only omitted/empty IDs resolve to `default`.

```typescript
expect(provider.resolveTeam('engineering')).toMatchObject({
  id: 'engineering',
  organizer: { id: 'organizer' },
  members: [{ id: 'architect' }, { id: 'reviewer' }],
});
expect(() => provider.resolveAgent('missing')).toThrow('Unknown agent: missing');
expect(() => provider.resolveTeam('broken')).toThrow('Unknown team member: missing');
```

- [x] **Step 2: Verify the focused tests fail**

Run:

```bash
pnpm vitest run packages/core/tests/default-config-provider.test.ts packages/core/tests/team-resolver.test.ts
```

Expected: FAIL because Team contracts and `resolveTeam()` do not exist.

- [x] **Step 3: Add configuration contracts and strict resolution**

Add these exact public shapes and defaults:

```typescript
export interface TeamConfig { organizer: string; members: string[] }
export interface ResolvedTeam {
  id: string;
  organizer: ResolvedAgentRole;
  members: ResolvedAgentRole[];
}
export interface OrchestrationConfig {
  maxAgentRuns?: number;
  maxMessages?: number;
  maxDepth?: number;
  timeoutMs?: number;
  maxTokens?: number;
  maxParallelAgents?: number;
}
export interface ResolvedOrchestrationConfig {
  maxAgentRuns: number; maxMessages: number; maxDepth: number;
  timeoutMs: number; maxTokens: number; maxParallelAgents: number;
}
```

Extend `AgentConfig` with `teams` and `orchestration`; extend ConfigProvider with:

```typescript
resolveTeam(id: string): ResolvedTeam;
getOrchestrationConfig(): ResolvedOrchestrationConfig;
```

Use defaults `20/50/8/300000/200000/4`. `TeamResolver` must preserve configured member order and reject invalid
input; it must never invent an active/default Team. Update `FakeConfigProvider` with strict in-memory implementations
so the new interface remains usable throughout the existing test suite.

- [x] **Step 4: Run focused tests and Core typecheck**

```bash
pnpm vitest run packages/core/tests/default-config-provider.test.ts packages/core/tests/team-resolver.test.ts
pnpm --filter rem-agent-core typecheck
```

Expected: both test files PASS and no TypeScript errors.

- [x] **Step 5: Commit configuration support**

```bash
git add packages/core/src/sdk packages/core/src/plugins/config packages/core/tests/default-config-provider.test.ts packages/core/tests/team-resolver.test.ts
git commit -m "feat(core): resolve configured agent teams"
```

### Task 2: Replace AgentProfile Persistence with Config Agent IDs

**Files:**

- Delete: `packages/core/src/agent-profile/{model,store,agent-profile-usecase}.ts`
- Delete: `packages/core/src/plugins/storage/sqlite/agent-profile-store.ts`
- Modify: `packages/core/src/session/agent-thread/{model,store,agent-thread-usecase}.ts`
- Modify: `packages/core/src/session/session-agent-context-usecase.ts`
- Modify: `packages/core/src/session/messages/thread-context-projector.ts`
- Modify: `packages/core/src/sdk/storage-provider.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/{provider,index,schema}.ts`
- Replace: `packages/core/src/plugins/storage/sqlite/schema/agent-ddl.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/schema/migrations.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/agent-thread-store.ts`
- Create: `packages/core/src/orchestration/delivery-model.ts`
- Create: `packages/core/src/orchestration/delivery-store.ts`
- Create: `packages/core/src/plugins/storage/sqlite/schema/delivery-ddl.ts`
- Modify: `packages/core/src/delegation/runner.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/agent-profile-thread-storage.test.ts` and rename it to `agent-thread-storage.test.ts`
- Modify: `packages/core/tests/message-projection.test.ts`
- Modify: `packages/core/tests/agent-system-thread.test.ts`

- [x] **Step 1: Rewrite tests around `agentId` and v10→v11 migration**

Assert that primary/team/delegated Threads round-trip `agentId`, persistent `(sessionId, agentId)` is unique,
Session deletion cascades Threads, and no `agent_profiles` table exists. Build a v10 fixture containing
`default-primary` and another profile ID; after migration expect `default` and the unchanged custom ID.

```typescript
expect(thread).toMatchObject({ agentId: 'default', role: 'primary' });
expect(tableNames).not.toContain('agent_profiles');
expect(CURRENT_SCHEMA_VERSION).toBe(11);
```

- [x] **Step 2: Run focused tests and observe profile-shaped failures**

```bash
pnpm vitest run packages/core/tests/agent-thread-storage.test.ts packages/core/tests/sqlite-storage.test.ts packages/core/tests/message-projection.test.ts packages/core/tests/agent-system-thread.test.ts
```

Expected: FAIL on `agentProfileId`, schema version 10 and Profile dependencies.

- [x] **Step 3: Implement v11 Thread identity and migration**

Use this domain model:

```typescript
export interface AgentThread {
  agentThreadId: string;
  sessionId: string;
  agentId: string;
  role: AgentThreadRole;
  lifecycle: AgentThreadLifecycle;
  createdAt: Date;
  updatedAt: Date;
}
```

Rebuild `agent_threads` inside a transaction with foreign keys temporarily disabled outside the transaction. Copy
`CASE agent_profile_id WHEN 'default-primary' THEN 'default' ELSE agent_profile_id END`, recreate indexes, drop
`agent_profiles`, then create the complete v11 `message_deliveries` table, re-enable foreign keys and run
`PRAGMA foreign_key_check`. Define the Delivery domain/store contracts now so the v11 DDL is final in this task;
Task 3 implements its Store without another schema-version change.

- [x] **Step 4: Resolve projection names from ConfigProvider**

Change `projectThreadContext` input from persisted Profiles to resolved Agents:

```typescript
interface ThreadContextProjectionInput {
  entries: SessionTreeEntry[];
  leafId: string | null;
  target: AgentThread;
  threads: AgentThread[];
  agents: ResolvedAgentRole[];
}
```

Inject ConfigProvider into `SessionAgentContextUsecase`; obtain `configProvider.forWorkspace(session.workspace)`,
resolve every Thread `agentId`, and throw
`ProjectionError` when configuration is missing. Delegated Thread creation inherits `parentThread.agentId`.

- [x] **Step 5: Remove Profile exports/provider plumbing and run verification**

```bash
pnpm vitest run packages/core/tests/agent-thread-storage.test.ts packages/core/tests/sqlite-storage.test.ts packages/core/tests/message-projection.test.ts packages/core/tests/agent-system-thread.test.ts
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core check-structure
```

Expected: focused tests PASS, no `agentProfile` symbol remains in active Core.

- [x] **Step 6: Commit identity migration**

```bash
git add packages/core
git commit -m "refactor(core): source agent identities from config"
```

### Task 3: Persist Deliveries and Atomically Enqueue Agent Messages

**Files:**

- Create: `packages/core/src/orchestration/delivery-errors.ts`
- Create: `packages/core/src/orchestration/delivery-usecase.ts`
- Create: `packages/core/src/session/messages/write-coordinator.ts`
- Create: `packages/core/src/plugins/storage/sqlite/message-delivery-store.ts`
- Create: `packages/core/src/plugins/storage/sqlite/orchestration-store.ts`
- Modify: `packages/core/src/sdk/storage-provider.ts`
- Modify: `packages/core/src/sdk/session-provider.ts`
- Modify: `packages/core/src/plugins/session/default/index.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/{provider,index,schema}.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/message-delivery-storage.test.ts`
- Create: `packages/core/tests/orchestration-enqueue.test.ts`

- [x] **Step 1: Add failing Delivery state-machine and atomic enqueue tests**

Test batch creation, ordered queued reads, unique `(kind,batch,target)`, atomic claim, same-Thread processing exclusion,
complete/fail/interrupt, root interruption and `processing→interrupted` recovery. In a transaction rollback test force
the second Delivery insert to fail and assert neither Message entry nor first Delivery remains.

```typescript
await expect(store.claim(second.deliveryId)).resolves.toBe(false);
expect(await deliveryStore.listByRoot(rootId)).toEqual([]);
expect(await sessionStore.listEntries(sessionId)).toEqual([]);
```

- [x] **Step 2: Verify tests fail because Delivery APIs are absent**

```bash
pnpm vitest run packages/core/tests/message-delivery-storage.test.ts packages/core/tests/orchestration-enqueue.test.ts
```

- [x] **Step 3: Implement Delivery contracts and SQLite store**

Implement the exact spec fields, terminal-state guard and methods:

```typescript
interface MessageDeliveryStore {
  createBatch(items: MessageDelivery[]): Promise<void>;
  get(deliveryId: string): Promise<MessageDelivery | null>;
  listByRoot(sessionId: string, rootUserMessageId: string): Promise<MessageDelivery[]>;
  listQueued(sessionId: string, rootUserMessageId: string): Promise<MessageDelivery[]>;
  claim(deliveryId: string): Promise<boolean>;
  complete(deliveryId: string): Promise<void>;
  fail(deliveryId: string, error: string): Promise<void>;
  interruptRoot(sessionId: string, rootUserMessageId: string): Promise<number>;
  recoverProcessing(): Promise<number>;
}
```

`claim` uses one conditional UPDATE with `status='queued'` plus `NOT EXISTS` processing for the target Thread.
The Store targets the v11 table created in Task 2 and must not advance `CURRENT_SCHEMA_VERSION`.

- [x] **Step 4: Share one Session-keyed write coordinator**

Move Promise-tail ownership out of SessionMessageAppender into:

```typescript
class SessionWriteCoordinator {
  run<T>(sessionId: string, operation: () => Promise<T>): Promise<T>;
}
```

DefaultSessionProvider creates one coordinator. Both `appendMessage()` and new
`appendMessageWithDeliveries(input: { sessionId: string; message: Message; deliveries: MessageDelivery[] })` use it.
The latter delegates to `OrchestrationStore`, whose SQLite transaction reads
the active leaf, inserts one entry, advances the leaf and inserts the complete Delivery batch.

- [x] **Step 5: Run Delivery, existing appender and SQLite tests**

```bash
pnpm vitest run packages/core/tests/message-delivery-storage.test.ts packages/core/tests/orchestration-enqueue.test.ts packages/core/tests/session-message-appender.test.ts packages/core/tests/sqlite-storage.test.ts
pnpm --filter rem-agent-core typecheck
```

- [x] **Step 6: Commit persistent Delivery infrastructure**

```bash
git add packages/core
git commit -m "feat(core): persist atomic agent message deliveries"
```

### Task 4: Build the Three-Level Runtime Model

**Files:**

- Create: `packages/core/src/session/agent-thread-runtime.ts`
- Create: `packages/core/src/session/agent-thread-runtime-registry.ts`
- Create: `packages/core/src/orchestration/discussion-runtime.ts`
- Create: `packages/core/src/orchestration/discussion-budget.ts`
- Modify: `packages/core/src/session/runtime.ts`
- Modify: `packages/core/src/session/runtime-registry.ts`
- Modify: `packages/core/src/agent/rem-agent.ts`
- Modify: `packages/core/src/system/agent-system.ts` enough to preserve the single-Agent path
- Modify: `packages/core/tests/session-runtime.test.ts`
- Modify: `packages/core/tests/session-runtime-registry.test.ts`
- Create: `packages/core/tests/agent-thread-runtime.test.ts`
- Create: `packages/core/tests/discussion-runtime.test.ts`
- Modify: `packages/core/tests/rem-agent.test.ts`

- [x] **Step 1: Write failing Runtime and transcript synchronization tests**

Assert same-Thread tasks execute FIFO after rejection, different ThreadRuntime instances overlap, SessionRuntime
allows only one active Discussion, interrupt reaches every running Agent, and `syncTranscript` rejects while running
but replaces messages while idle without emitting persistence events.

```typescript
agent.syncTranscript([incoming]);
expect(modelContextRoles).toEqual(['user']);
expect(() => runningAgent.syncTranscript([])).toThrow('Cannot sync transcript while running');
```

- [x] **Step 2: Verify Runtime tests fail**

```bash
pnpm vitest run packages/core/tests/agent-thread-runtime.test.ts packages/core/tests/discussion-runtime.test.ts packages/core/tests/session-runtime.test.ts packages/core/tests/rem-agent.test.ts
```

- [x] **Step 3: Implement focused Runtime classes**

`AgentThreadRuntime.enqueue()` owns a Promise tail with failure recovery and matching-tail cleanup. Runtime status
changes `queued→running→idle/error`; interrupt delegates to its REMAgent. Registry caches pending/resolved creation by
agentThreadId just like SessionRuntimeRegistry.

`SessionRuntime` becomes:

```typescript
class SessionRuntime {
  readonly sessionId: string;
  readonly workspace: string;
  readonly mode: 'single' | 'multi-agent';
  readonly threadRuntimes: AgentThreadRuntimeRegistry;
  activeDiscussion?: DiscussionRuntime;
  startDiscussion(rootUserMessageId: string, config: ResolvedOrchestrationConfig): DiscussionRuntime;
  finishDiscussion(): void;
  interrupt(): void;
}
```

Keep current single-Agent behavior by registering its primary REMAgent as the initial ThreadRuntime.

- [x] **Step 4: Implement `REMAgent.syncTranscript()`**

Only allow idle/finished/error states, replace `messages` with a shallow copy, clear no persistent data and emit no
events. Reset per-run turn counters in `beginRun()` so maxTurns applies to each delivery rather than the lifetime of
the cached Agent.

- [x] **Step 5: Run Runtime and existing AgentSystem tests**

```bash
pnpm vitest run packages/core/tests/agent-thread-runtime.test.ts packages/core/tests/discussion-runtime.test.ts packages/core/tests/session-runtime.test.ts packages/core/tests/session-runtime-registry.test.ts packages/core/tests/rem-agent.test.ts packages/core/tests/agent-system.test.ts
pnpm --filter rem-agent-core typecheck
```

- [x] **Step 6: Commit Runtime hierarchy**

```bash
git add packages/core
git commit -m "feat(core): add serialized agent thread runtimes"
```

### Task 5: Add `send_message` and `finish_discussion` Protocols

**Files:**

- Create: `packages/core/src/orchestration/communication-message.ts`
- Create: `packages/core/src/orchestration/orchestration-actions.ts`
- Create: `packages/core/src/orchestration/send-message-tool.ts`
- Create: `packages/core/src/orchestration/finish-discussion-tool.ts`
- Modify: `packages/core/src/agent/rem-agent-params.ts`
- Modify: `packages/core/src/runtime/agent-loop-assembler.ts`
- Modify: `packages/core/src/runtime/agent-tools.ts`
- Modify: `packages/core/src/session/messages/payload.ts` only if discussion metadata input helpers are needed
- Create: `packages/core/tests/orchestration-tools.test.ts`

- [x] **Step 1: Add failing tool contract tests**

Assert definitions use strict schemas, send targets are deduplicated, self/unknown/non-Team targets fail, a Member
can send, finish is absent for Members, Organizer finish trims answer, and budget-locked discussions reject send.

```typescript
expect(agentTools.tools.map((tool) => tool.name)).toContain('send_message');
expect(memberTools.tools.map((tool) => tool.name)).not.toContain('finish_discussion');
expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ toAgentIds: ['architect'] }));
```

- [x] **Step 2: Verify tool tests fail**

```bash
pnpm vitest run packages/core/tests/orchestration-tools.test.ts
```

- [x] **Step 3: Implement communication message construction**

Resolve the pi Model before assembling tools. Build a valid zero-usage AssistantMessage using its `api`, provider and
id, with one text block and `stopReason:'stop'`. Never introduce a Harness-only Message role.

- [x] **Step 4: Implement tool definitions and injected actions**

Use callbacks rather than importing Scheduler into runtime assembly:

```typescript
interface AgentOrchestrationActions {
  sendMessage(input: { toAgentIds: string[]; content: string }): Promise<{ batchId: string }>;
  finishDiscussion?(answer: string): Promise<void>;
}
```

Only inject these tools for multi-Agent persistent Threads. Keep `delegate_task` and todo behavior unchanged.

- [x] **Step 5: Run tool and loop assembly regression tests**

```bash
pnpm vitest run packages/core/tests/orchestration-tools.test.ts packages/core/tests/rem-agent-assembly.test.ts packages/core/tests/delegate-task.test.ts
pnpm --filter rem-agent-core typecheck
```

- [x] **Step 6: Commit Organizer protocol tools**

```bash
git add packages/core
git commit -m "feat(core): add agent messaging and discussion finish tools"
```

### Task 6: Implement the Deterministic Scheduler

**Files:**

- Create: `packages/core/src/orchestration/scheduler.ts`
- Create: `packages/core/src/orchestration/scheduler-types.ts`
- Create: `packages/core/src/orchestration/delivery-executor.ts`
- Create: `packages/core/src/orchestration/batch-completion.ts`
- Create: `packages/core/src/orchestration/concurrency-limiter.ts`
- Create: `packages/core/src/orchestration/synthetic-result-message.ts`
- Create: `packages/core/src/orchestration/agent-thread-event-driver.ts`
- Modify: `packages/core/src/session/session-agent-context-usecase.ts`
- Modify: `packages/core/src/session/session-usecase.ts`
- Modify: `packages/core/src/session/agent-thread/agent-thread-usecase.ts`
- Create: `packages/core/tests/orchestration-scheduler.test.ts`

- [x] **Step 1: Add a scripted mixed-Agent scheduler fixture**

Create one Organizer and two Members. Script Organizer `send_message`, overlap Member model promises, complete them,
then script Organizer `finish_discussion`. Record run start/end times and contexts.

- [x] **Step 2: Add failing scheduler assertions**

Assert Organizer is first, two Members overlap, two Deliveries for the same Member do not overlap, every run starts
from a fresh Thread projection, batch completion creates exactly one resume, and final answer is persisted once.

```typescript
expect(maxConcurrentMembers).toBe(2);
expect(maxConcurrentByThread.get(architectThreadId)).toBe(1);
expect(resumeDeliveries).toHaveLength(1);
expect(finalMessages.filter(isFinalAnswer)).toHaveLength(1);
```

- [x] **Step 3: Implement claim/drain and Thread execution**

Scheduler drains queued Deliveries for one Discussion until none remain or finish/failure occurs. It claims before
enqueue, passes claimed work through the target AgentThreadRuntime, projects the latest context, calls
`syncTranscript()` and `continue()`, then uses `agent-thread-event-driver.ts` to persist and publish events with the
target Thread ID without changing the single-Agent `agent-run-driver.ts` contract.

Use `maxParallelAgents` in a small limiter; per-Thread serialization remains in AgentThreadRuntime.

- [x] **Step 4: Implement batch completion and failure projection**

After each terminal message Delivery, check the full batch. If terminal and requestedBy exists, insert one resume
Delivery via the unique constraint. A Member failure appends one public synthetic AssistantMessage authored by that
Thread before failing the Delivery. Organizer failure interrupts the root and marks Discussion failed.

- [x] **Step 5: Implement actions used by tools**

Bind each Agent's callbacks to its current Delivery/Discussion. `sendMessage` resolves Team Threads, computes
`depth+1`, and atomically appends communication Message plus Delivery batch. `finishDiscussion` records the request;
Scheduler validates it after the current Organizer run completes.

- [x] **Step 6: Run scheduler tests and typecheck**

```bash
pnpm vitest run packages/core/tests/orchestration-scheduler.test.ts packages/core/tests/message-projection.test.ts packages/core/tests/agent-run-driver.test.ts
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core check-structure
```

- [x] **Step 7: Commit Scheduler**

```bash
git add packages/core
git commit -m "feat(core): schedule persistent multi-agent discussions"
```

### Task 7: Integrate Multi-Agent Sessions into AgentSystem

**Files:**

- Modify: `packages/core/src/system/types.ts`
- Modify: `packages/core/src/system/create-agent-system.ts`
- Modify: `packages/core/src/system/agent-system.ts`
- Modify: `packages/core/src/agent/bus-events.ts`
- Modify: `packages/core/src/session/manager/types.ts`
- Modify: `packages/core/src/session/session-usecase.ts`
- Modify: `packages/core/src/session/agent-thread/agent-thread-usecase.ts`
- Create: `packages/core/src/orchestration/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/multi-agent-system.test.ts`
- Modify: `packages/core/tests/agent-system.test.ts`
- Modify: `packages/core/tests/agent-system-thread.test.ts`

- [x] **Step 1: Add failing public API integration tests**

Test `createSession({workspace})` remains single-Agent, `createSession({workspace,teamId:'engineering'})` saves the
Team and creates one Organizer plus configured Members, `send()` starts Organizer, and query methods return group and
Thread projections. Assert the caller never supplies an Agent ID to send.

```typescript
const session = await system.createSession({ workspace: 'ws', teamId: 'engineering' });
expect((await system.getSessionThreads(session.sessionId)).map((t) => t.role))
  .toEqual(['organizer', 'member', 'member']);
```

- [x] **Step 2: Extend AgentSystem contracts and events**

Add optional `teamId`, SessionInfo mode/team fields, three read APIs from the spec, and event variants carrying
`agentThreadId`, rootUserMessageId, Delivery and Discussion status. Do not expose mutable Runtime maps.

- [x] **Step 3: Branch `send()` by persisted Session mode**

Single mode continues through the existing primary Thread path. Multi-Agent mode persists one user Message with a
generated root message ID and initial Organizer Delivery without requestedBy in one
`appendMessageWithDeliveries()` transaction, starts DiscussionRuntime and awaits Scheduler driving. Both modes retain
one `session-start/session-end` lifecycle.

- [x] **Step 4: Wire creation and read Usecases**

AgentThreadUsecase adds idempotent `ensureTeamThreads(sessionId, team)`. SessionUsecase stores teamId in metadata and
validates it through workspace ConfigProvider before returning SessionInfo. Read APIs use existing projectors and
strict Thread/Session membership checks.

- [x] **Step 5: Run single/multi/child integration suites**

```bash
pnpm vitest run packages/core/tests/multi-agent-system.test.ts packages/core/tests/agent-system.test.ts packages/core/tests/agent-system-thread.test.ts packages/core/tests/agent-system-delegation.test.ts
pnpm --filter rem-agent-core typecheck
```

- [x] **Step 6: Commit AgentSystem integration**

```bash
git add packages/core
git commit -m "feat(core): expose organizer-driven multi-agent sessions"
```

### Task 8: Enforce Budgets, Interrupt and Recovery

**Files:**

- Modify: `packages/core/src/orchestration/discussion-budget.ts`
- Modify: `packages/core/src/orchestration/discussion-runtime.ts`
- Modify: `packages/core/src/orchestration/scheduler.ts`
- Modify: `packages/core/src/orchestration/delivery-usecase.ts`
- Modify: `packages/core/src/system/agent-system.ts`
- Modify: `packages/core/src/session/session-usecase.ts`
- Create: `packages/core/tests/discussion-budget.test.ts`
- Create: `packages/core/tests/multi-agent-interrupt-recovery.test.ts`

- [x] **Step 1: Add failing budget tests**

Test each independent bound at `limit-1`, `limit` and `limit+1`: Agent runs, Message count, depth, elapsed time and
token usage. Test one and only one restricted Organizer resume and rejection of send_message while restricted.

- [x] **Step 2: Add failing interrupt/restart tests**

Block two Member model calls, interrupt the Session, and assert both signals abort plus queued/processing Delivery
terminal states. Insert processing Deliveries, create a new AgentSystem, trigger recovery and expect interrupted with
no model invocation or tool replay.

- [x] **Step 3: Implement budget accounting and restricted summary mode**

DiscussionBudgetState records counters from persisted Message/Delivery/usage events, not estimates hidden inside the
Scheduler. On exhaustion, stop ordinary claims, interrupt Members, interrupt queued work, and idempotently enqueue
one Organizer resume whose actions expose finish only.

- [x] **Step 4: Implement Session-wide interrupt and startup recovery**

`SessionRuntime.interrupt()` aborts Discussion and every ThreadRuntime. DeliveryUsecase interrupts the active root.
Recovery runs once per AgentSystem alongside child recovery, converting every processing Delivery to interrupted;
it never creates new queued work.

- [x] **Step 5: Run budget/recovery and full test suite**

```bash
pnpm vitest run packages/core/tests/discussion-budget.test.ts packages/core/tests/multi-agent-interrupt-recovery.test.ts
pnpm --filter rem-agent-core build
pnpm test
pnpm typecheck
pnpm --filter rem-agent-core check-structure
git diff --check
```

Expected: all Core tests pass, build/typecheck/structure are green, and no active source contains `AgentProfile`.

- [x] **Step 6: Commit reliability semantics**

```bash
git add packages/core
git commit -m "feat(core): enforce multi-agent budgets and recovery"
```

### Task 9: Update Architecture Documentation and Final Verification

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/module-reference.md`
- Modify: `docs/superpowers/plans/2026-08-02-config-driven-multi-agent-orchestration.md` — check completed steps only after verification

- [x] **Step 1: Update current-state documentation**

Document `agents/teams`, explicit teamId semantics, Runtime ownership, Delivery state machine, tools, budgets, query
APIs and recovery. Remove statements that Organizer/Scheduler are merely planned and remove AgentProfile references
from active architecture descriptions.

- [x] **Step 2: Run forbidden-pattern and module-boundary scans**

```bash
rg -n "AgentProfile|agent_profiles|agentProfileId|activeTeam|thread_messages|messagesByThread" packages/core/src docs/architecture.md docs/module-reference.md
find packages/core/src/orchestration -maxdepth 1 -type f -name '*.ts' -print -exec wc -l {} \;
```

Expected: first command has no matches; implementation files remain below the module-separation hard limit.

- [x] **Step 3: Run final verification from a clean build**

```bash
pnpm --filter rem-agent-core build
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core check-structure
pnpm test
git diff --check
git status --short
```

Expected: all commands pass; status contains only the planned docs/checklist changes before the final commit.

- [x] **Step 4: Commit documentation and completed plan**

```bash
git add docs packages/core
git commit -m "docs: document config-driven multi-agent runtime"
```
