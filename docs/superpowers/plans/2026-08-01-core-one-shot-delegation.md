# Core One-Shot Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace parent-owned child Agents with a Core `DelegationRunner` that creates an independent child Session, runs a temporary recursive child Agent, persists its history, emits lifecycle updates, and releases the Agent after one call.

**Architecture:** `delegate_task` becomes a thin adapter over a `RunDelegation` port. `DelegationRunner` owns one-shot creation and recursive closures, while `DelegationEventDriver` owns child event persistence; `SessionService` owns delegation metadata and restart repair. AbortSignal follows the standard AgentTool-to-ToolContext path.

**Tech Stack:** TypeScript, pi-ai, pi-agent-core, Vitest, pnpm

---

## File Structure

- Create `packages/core/src/delegation/types.ts`: request/context/result/status and runner port types.
- Create `packages/core/src/delegation/depth.ts`: max-depth validation and checks.
- Create `packages/core/src/delegation/errors.ts`: invalid configuration and depth errors.
- Create `packages/core/src/delegation/event-driver.ts`: child event persistence and usage aggregation.
- Create `packages/core/src/delegation/runner.ts`: one-shot Agent lifecycle and recursive delegation.
- Create `packages/core/src/delegation/index.ts`: public aggregation.
- Modify `capabilities/sub-agent/delegate-task.ts`: call `RunDelegation`; remove parent Agent handling.
- Modify `runtime/agent-tools.ts`: propagate AgentTool AbortSignal into ToolContext.
- Modify `runtime/agent-loop-assembler.ts` and `agent/rem-agent-params.ts`: inject `RunDelegation` instead of `SpawnChild`.
- Modify `session/service.ts`: create/update/recover delegation Sessions.
- Modify `system/create-agent-system.ts`, `system/agent-system.ts`, and `system/types.ts`: assemble Runner, configure depth, inject root delegation closure, and run recovery.
- Modify `agent/rem-agent.ts` and `agent/agent-event.ts`: remove child object ownership/events.
- Modify `agent/agent-run-driver.ts` and `agent/bus-events.ts`: remove child-spawn ignore and add interrupted lifecycle status.
- Replace old delegation tests and add depth, signal, Session, Runner, recovery, and integration coverage.

### Task 1: Thin delegate_task Port and AbortSignal Propagation

**Files:**

- Create: `packages/core/src/delegation/types.ts`
- Modify: `packages/core/src/capabilities/sub-agent/delegate-task.ts`
- Modify: `packages/core/src/runtime/agent-tools.ts`
- Test: `packages/core/tests/delegate-task.test.ts`
- Test: `packages/core/tests/agent-tools.test.ts`

- [ ] **Step 1: Replace old executor tests with port tests**

Use a mocked `RunDelegation` returning `{ childSessionId: 'child-1', content: 'done', status: 'completed' }`.
Assert it receives the tool input/context and that output contains child ID/content. Add failed and thrown cases and
assert both format a failed task result without throwing.

- [ ] **Step 2: Add a failing AgentTools signal test**

Create an overlay tool whose executor captures `ctx.signal`, call the resulting pi tool as
`tool.execute('tc-1', {}, controller.signal)`, and expect the identical signal.

- [ ] **Step 3: Run focused tests and observe current failures**

```bash
pnpm vitest run packages/core/tests/delegate-task.test.ts packages/core/tests/agent-tools.test.ts
```

- [ ] **Step 4: Define delegation types and rewrite executor**

Define `DelegationStatus`, `DelegationRequest`, `DelegationContext`, `DelegationResult`, and:

```typescript
export type RunDelegation = (
  request: DelegationRequest,
  toolContext: ToolContext,
) => Promise<DelegationResult>;
```

Change `createDelegateTaskExecutor(runDelegation)` to call the port and format status other than completed as
failed. Retain exception-to-failed-result behavior.

- [ ] **Step 5: Propagate signal through agent-tools**

Add `signal?: AbortSignal` to `executeOne`, set it on ToolContext, and change the adapter to:

```typescript
execute: async (toolCallId, input, signal) => {
  const result = await executeOne(toolCallId, piTool.name, input, signal);
  // existing result conversion
}
```

- [ ] **Step 6: Run tests/typecheck and commit**

```bash
pnpm vitest run packages/core/tests/delegate-task.test.ts packages/core/tests/agent-tools.test.ts
pnpm --filter rem-agent-core typecheck
git add packages/core/src/delegation/types.ts packages/core/src/capabilities/sub-agent/delegate-task.ts packages/core/src/runtime/agent-tools.ts packages/core/tests/delegate-task.test.ts packages/core/tests/agent-tools.test.ts
git commit -m "refactor(core): define delegation execution port"
```

### Task 2: Delegation Session State and Restart Recovery

**Files:**

- Create: `packages/core/src/delegation/depth.ts`
- Create: `packages/core/src/delegation/errors.ts`
- Modify: `packages/core/src/session/service.ts`
- Modify: `packages/core/src/session/manager/types.ts`
- Test: `packages/core/tests/delegation-depth.test.ts`
- Test: `packages/core/tests/session-service.test.ts`

- [ ] **Step 1: Add failing depth/session/recovery tests**

Assert default depth 3, integer range 1..16, and `assertDelegationDepth(4, 3)` failure. Create a child Session and
assert exact metadata fields/direct parent. Create two running delegation Sessions, call recovery, and expect both
interrupted and count 2.

- [ ] **Step 2: Implement depth helpers**

Export `DEFAULT_DELEGATION_MAX_DEPTH = 3`, `resolveDelegationMaxDepth(value)`, and
`assertDelegationDepth(depth, maxDepth)`. Invalid system configuration throws
`InvalidDelegationDepthError`; runtime overflow throws `DelegationDepthExceededError`.

- [ ] **Step 3: Add SessionService delegation APIs**

Implement:

```typescript
createDelegationSession(input): Promise<Session>;
setDelegationStatus(sessionId, status): Promise<void>;
recoverInterruptedDelegations(): Promise<number>;
```

Creation trims task title to 50 chars and saves all specified metadata. Recovery uses `sessionProvider.list()` and
loads summaries one by one, updating only `type === 'delegation' && status === 'running'`.

- [ ] **Step 4: Surface parentToolCallId in SessionInfo**

Add it in `SessionService.toInfo()` so child history can be located from the parent tool call.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
pnpm vitest run packages/core/tests/delegation-depth.test.ts packages/core/tests/session-service.test.ts
pnpm --filter rem-agent-core typecheck
git add packages/core/src/delegation packages/core/src/session packages/core/tests/delegation-depth.test.ts packages/core/tests/session-service.test.ts
git commit -m "feat(core): persist delegation session lifecycle"
```

### Task 3: One-Shot Driver and Recursive Runner

**Files:**

- Create: `packages/core/src/delegation/event-driver.ts`
- Create: `packages/core/src/delegation/runner.ts`
- Create: `packages/core/src/delegation/index.ts`
- Modify: `packages/core/src/agent/rem-agent-params.ts`
- Modify: `packages/core/src/runtime/agent-loop-assembler.ts`
- Test: `packages/core/tests/delegation-event-driver.test.ts`
- Test: `packages/core/tests/delegation-runner.test.ts`

- [ ] **Step 1: Write failing event-driver tests**

Feed message/usage/title/finish events, assert serial SessionService calls and accumulated usage. Reject persistence
and assert the driver reports failure instead of swallowing it.

- [ ] **Step 2: Write failing Runner lifecycle/depth tests**

Inject fake SessionService/EventDriver/AgentFactory. Assert child Session creation, child params, child output mapping,
terminal status update, running/completed events, overflow without Session creation, and recursive closure using the
child Session as direct parent with depth + 1.

- [ ] **Step 3: Implement DelegationEventDriver**

Return `{ usage, output }` after consuming the run. Persist message/usage/title/compress-end/finish; ignore private
stream events for system publication. Let persistence failures reject.

- [ ] **Step 4: Implement DelegationRunner**

Validate depth before Session creation, publish running, create the temporary Agent with signal/systemPrompt/maxTurns,
inject a recursive `runDelegation` closure, run/drain, derive completed/failed/interrupted from signal and output,
persist terminal status, publish terminal update, return result, and retain no Agent reference.

- [ ] **Step 5: Replace SpawnChild injection with RunDelegation**

Change `REMAgentParams.spawnChild` to `runDelegation`; update assembler to create the delegate overlay using the new
executor. When absent, return a failed port error stating delegation is unavailable.

- [ ] **Step 6: Run focused tests/typecheck and commit**

```bash
pnpm vitest run packages/core/tests/delegation-event-driver.test.ts packages/core/tests/delegation-runner.test.ts packages/core/tests/rem-agent.test.ts
pnpm --filter rem-agent-core typecheck
git add packages/core/src/delegation packages/core/src/agent/rem-agent-params.ts packages/core/src/runtime/agent-loop-assembler.ts packages/core/tests
git commit -m "feat(core): run one-shot recursive delegations"
```

### Task 4: AgentSystem Integration and Remove Child Object Ownership

**Files:**

- Modify: `packages/core/src/system/types.ts`
- Modify: `packages/core/src/system/create-agent-system.ts`
- Modify: `packages/core/src/system/agent-system.ts`
- Modify: `packages/core/src/agent/rem-agent.ts`
- Modify: `packages/core/src/agent/agent-event.ts`
- Modify: `packages/core/src/agent/agent-run-driver.ts`
- Modify: `packages/core/src/agent/bus-events.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/agent-system-delegation.test.ts`
- Modify: existing REMAgent/AgentSystem tests.

- [ ] **Step 1: Write failing end-to-end delegation tests**

Script root tool call -> child answer -> root final answer. Assert parent/child conversations are isolated, direct
parent metadata is correct, events are running/completed, and only one persistent root Agent is retained. Add nested
delegation, max-depth failure, parent interrupt, child failure followed by parent final answer, and recovery tests.

- [ ] **Step 2: Assemble Runner in createAgentSystem**

Validate options, create DelegationEventDriver/Runner with the shared SessionService/bus, and pass a root
`runDelegation` closure into CoreAgentSystem. CoreAgentSystem binds parent Session/workspace/depth 1 while Runner binds
recursive children.

- [ ] **Step 3: Add idempotent recovery gate**

CoreAgentSystem stores one recovery Promise and awaits it before create/get/list/send. Recovery errors reject the
use case. interrupt remains an in-memory no-op and does not trigger recovery.

- [ ] **Step 4: Remove old child ownership**

Delete `children`, `parentToolCallId`, and `attachChild()` from REMAgent; delete `child-spawned` from REMAgentEvent;
remove its ignore branch from AgentRunDriver and rewrite obsolete tests.

- [ ] **Step 5: Export delegation API and extend status event**

Allow interrupted in `child-agent-update`, export delegation types/helpers/runner from `delegation/index.ts` and package
root, and preserve unrelated APIs.

- [ ] **Step 6: Run full verification**

```bash
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core check-structure
pnpm --filter rem-agent-core build
pnpm test
git diff --check
```

Expected: all commands pass; no `children`, `attachChild`, `child-spawned`, or `SpawnChild` remains in active Core.

- [ ] **Step 7: Commit**

```bash
git add packages/core docs/superpowers/plans/2026-08-01-core-one-shot-delegation.md
git commit -m "feat(core): integrate one-shot child agents"
```
