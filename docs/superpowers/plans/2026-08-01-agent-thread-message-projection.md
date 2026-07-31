# AgentThread and Message Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Agent profiles and per-Session thread identities while keeping one canonical message stream that projects into group chat and per-Agent model contexts.

**Architecture:** Profile and Thread get stable SDK stores with SQLite v10 implementations. Message metadata remains inside `session_entries`; a keyed appender serializes writes, while pure projectors normalize old entries and derive views. Single-Agent and delegation runtimes then bind their Agents to persisted Threads.

**Tech Stack:** TypeScript, SQLite/better-sqlite3, pi-ai, Vitest, pnpm

---

## File Structure

- Add `agent-profile/{model,store,service}.ts`.
- Add `session/agent-thread/{model,store,service}.ts`.
- Add SQLite DDL/converters/stores and v9→v10 migration.
- Extend `StorageProvider` and SQLite provider.
- Add `session/messages/{payload,normalize,entry-chain,appender,session-chat-projector,thread-context-projector}.ts`.
- Extend SessionProvider/DefaultSessionProvider with metadata-aware append and entry reads.
- Bind primary/delegated Threads into SessionRuntime, SessionService, AgentSystem, Driver and DelegationRunner.

### Task 1: Profile and Thread Domain Stores

**Files:**

- Create domain model/store/service modules listed above.
- Modify `sdk/storage-provider.ts`.
- Create `plugins/storage/sqlite/agent-profile-store.ts` and `agent-thread-store.ts`.
- Create `plugins/storage/sqlite/schema/agent-ddl.ts`.
- Modify SQLite schema, migrations, provider and exports.
- Test `agent-profile-thread-storage.test.ts` and `sqlite-storage.test.ts`.

- [ ] **Step 1: Write failing CRUD and constraint tests**

Create a Profile, create primary Thread, round-trip Dates, list by Session, reject a second primary, cascade Thread
on Session deletion, and reject deleting a referenced Profile. Add a v9 database migration assertion for both tables.

- [ ] **Step 2: Define domain models and SDK stores**

Use the exact spec fields. `AgentProfileStore` exposes save/get/list/delete;
`AgentThreadStore` exposes save/get/listBySession/delete. Add both readonly stores to `StorageProvider`.

- [ ] **Step 3: Implement SQLite v10**

Add tables with foreign keys, indexes, unique partial indexes for primary/organizer, and unique persistent
`(session_id, agent_profile_id)`. Increment `CURRENT_SCHEMA_VERSION` to 10 and execute identical DDL for version <10.
Enable foreign keys in provider initialization before migrations.

- [ ] **Step 4: Implement services**

`AgentProfileService.ensureDefaultPrimary()` saves stable `default-primary` idempotently.
`AgentThreadService.ensurePrimaryThread(sessionId)` returns existing or inserts a generated persistent primary,
recovering unique conflicts by rereading. Add delegated Thread creation and list.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run packages/core/tests/agent-profile-thread-storage.test.ts packages/core/tests/sqlite-storage.test.ts
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core check-structure
git add packages/core
git commit -m "feat(core): persist agent profiles and threads"
```

### Task 2: Canonical Message Metadata and Serialized Append

**Files:**

- Create all `session/messages/` modules except projectors.
- Modify `session/tree/types.ts`, `sdk/session-provider.ts`, `plugins/session/default/index.ts`.
- Modify `plugins/storage/sqlite/session-store.ts` only where atomic entry append support is required.
- Test `message-payload.test.ts` and `session-message-appender.test.ts`.

- [ ] **Step 1: Write failing normalization/validation tests**

Assert legacy user/assistant/toolResult defaults against a supplied primary Thread. Assert invalid agent/tool author or
thread scope without thread ID is rejected and mentions are deduplicated.

- [ ] **Step 2: Write failing keyed serialization tests**

Use a deferred fake Store: two appends for one Session must not overlap; another Session may proceed concurrently;
after a rejected append, the next append for that Session succeeds.

- [ ] **Step 3: Implement payload and active-chain helpers**

Extend `MessageEntryPayload` with optional Harness metadata. Implement validation/normalization and a shared
`getActiveEntryChain(entries, leafId)` so conversation loading and both projectors use identical branch semantics.

- [ ] **Step 4: Implement SessionMessageAppender**

Maintain `Map<sessionId, Promise<void>>` tails. Inside the queued operation read active leaf and append the complete
payload. Clear only the matching settled tail in finally. Different keys never wait on each other.

- [ ] **Step 5: Route DefaultSessionProvider through the appender**

Change append to accept a complete payload, update the in-memory Session conversation after successful append, and
expose `listEntries/getActiveLeafId` reads needed by projections. Update current call sites temporarily with explicit
legacy-compatible metadata; no projector may write.

- [ ] **Step 6: Verify and commit**

```bash
pnpm vitest run packages/core/tests/message-payload.test.ts packages/core/tests/session-message-appender.test.ts
pnpm --filter rem-agent-core typecheck
git add packages/core
git commit -m "feat(core): serialize canonical message writes"
```

### Task 3: Group and Thread Projections

**Files:**

- Create `session/messages/session-chat-projector.ts`.
- Create `session/messages/thread-context-projector.ts`.
- Test `message-projection.test.ts`.

- [ ] **Step 1: Write a mixed-message projection fixture**

Build two Profiles/Threads and an active entry chain containing public user, A public assistant, A private toolResult,
B public assistant, and B private toolResult. Include legacy messages and a non-active branch.

- [ ] **Step 2: Assert group projection**

Expect only public user/A/B messages in active-chain order, with author/mentions/reply/root metadata retained.

- [ ] **Step 3: Assert Thread A projection**

Expect A's own assistant/toolResult roles unchanged, B public reply converted to a user message prefixed
`[Agent: B]`, and B private result absent. Assert missing referenced Thread/Profile throws ProjectionError.

- [ ] **Step 4: Implement pure projectors and verify**

Use normalization plus active-chain helper. Do not access Stores or mutate Messages. Preserve supported text/image
content when converting another Agent response.

```bash
pnpm vitest run packages/core/tests/message-projection.test.ts
pnpm --filter rem-agent-core typecheck
git add packages/core
git commit -m "feat(core): project central messages by agent thread"
```

### Task 4: Bind Single-Agent and Delegation Runtimes

**Files:**

- Modify `session/runtime.ts`, `session/service.ts`, `system/create-agent-system.ts`, `system/agent-system.ts`.
- Modify `agent/agent-run-driver.ts`, `delegation/runner.ts`, `delegation/event-driver.ts`.
- Modify public exports.
- Test existing AgentSystem/delegation suites plus new `agent-system-thread.test.ts`.

- [ ] **Step 1: Write failing runtime integration tests**

First send creates default Profile + primary Thread. A second AgentSystem over the same Storage restores the same IDs
and projected history. New user/assistant entries carry session scope and primary author; toolResult carries primary
thread scope. Delegation creates one delegated/one-shot Thread inheriting the parent Profile.

- [ ] **Step 2: Assemble Profile/Thread services**

Create both services once in `createAgentSystem`, inject them into System and DelegationRunner, and expose no mutable
maps. `SessionRuntime` records its primary Thread ID.

- [ ] **Step 3: Project context before Agent creation**

On Runtime creation ensure primary Thread, read entries/leaf, load Session Threads/Profiles, call
`projectThreadContext`, and pass a Session clone containing that conversation to REMAgent. Reused Runtime continues
using REMAgent's transcript.

- [ ] **Step 4: Persist Agent events with Thread identity**

Driver passes primary/delegated Thread into SessionService. Map user to public user, assistant to public Agent, and
toolResult to private tool messages before append. Preserve messageId and discussion metadata fields.

- [ ] **Step 5: Bind delegated Threads**

Runner resolves the direct parent Thread/Profile, creates child Session then delegated Thread, and passes its ID to
DelegationEventDriver. Nested delegation inherits the direct parent's Profile.

- [ ] **Step 6: Full verification and commit**

```bash
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core check-structure
pnpm --filter rem-agent-core build
pnpm test
rg -n "thread_messages|messagesByThread" packages/core/src
git diff --check
git add packages/core docs/superpowers/plans/2026-08-01-agent-thread-message-projection.md
git commit -m "feat(core): bind agents to projected message threads"
```

Expected: all checks pass, the forbidden duplicate-message search has no matches, and the worktree is clean.
