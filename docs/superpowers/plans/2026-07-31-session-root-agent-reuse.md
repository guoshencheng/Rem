# Session Root Agent Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each in-memory `REMSession` reuse one root `REMAgent` across sequential runs while keeping child Agents and per-run cancellation independent.

**Architecture:** `REMSession` becomes the explicit owner of one root Agent and a separate child-Agent collection. `AgentsUniService` asks the session to create the root lazily, reuses it for later runs, and routes interrupt/reset/delete through a session-level cancellation method that aborts both the current run marker and the Agent loop.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, `rem-agent-core` `REMAgent`

---

## File Structure

- Modify `packages/bridge/src/rem-session.ts`: own the unique root Agent, child Agents, and coordinated run interruption.
- Modify `packages/bridge/src/agents-uni-service.ts`: lazily create/reuse the root Agent and stop relying on `agents[0]`.
- Modify `packages/bridge/tests/rem-session.test.ts`: unit-test root ownership and coordinated interruption.
- Modify `packages/bridge/tests/agents-uni-service.test.ts`: integration-test same-session reuse, transcript continuity, and cross-session isolation.

No new production module is needed: the responsibilities already belong to the two existing files, both remain below the project’s absolute file-size limits after this focused change.

### Task 1: Express Root and Child Agent Ownership in REMSession

**Files:**

- Modify: `packages/bridge/src/rem-session.ts:22-74`
- Test: `packages/bridge/tests/rem-session.test.ts`

- [ ] **Step 1: Write failing ownership and interruption tests**

Add `vi` and the `REMAgent` type imports, then append these tests:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { REMAgent } from 'rem-agent-core';

it('同一 session 只创建一个 root Agent，child Agent 单独计数', () => {
  const s = new REMSession({
    sessionId: 's-1',
    workspace: 'default',
    publish: () => {},
  });
  const root = { interrupt: vi.fn() } as unknown as REMAgent;
  const otherRoot = { interrupt: vi.fn() } as unknown as REMAgent;
  const child = {} as REMAgent;
  const createRoot = vi.fn(() => root);

  expect(s.getOrCreateRootAgent(createRoot)).toBe(root);
  expect(s.getOrCreateRootAgent(() => otherRoot)).toBe(root);
  expect(createRoot).toHaveBeenCalledTimes(1);

  s.addChildAgent(child);
  expect(s.rootAgent).toBe(root);
  expect(s.childAgentCount).toBe(1);
});

it('interruptRun 同时中止本轮 controller 和 root Agent', () => {
  const s = new REMSession({
    sessionId: 's-1',
    workspace: 'default',
    publish: () => {},
  });
  const interrupt = vi.fn();
  s.getOrCreateRootAgent(() => ({ interrupt }) as unknown as REMAgent);
  const controller = s.startRun();

  s.interruptRun();

  expect(controller.signal.aborted).toBe(true);
  expect(interrupt).toHaveBeenCalledTimes(1);
});
```

If the existing first import already imports `describe`, `expect`, and `it`, merge `vi` into that import rather than adding a duplicate.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --filter rem-agent-bridge test -- rem-session.test.ts
```

Expected: FAIL because `getOrCreateRootAgent`, `rootAgent`, `addChildAgent`, `childAgentCount`, and `interruptRun` do not exist.

- [ ] **Step 3: Implement explicit Agent ownership**

Replace `agents: REMAgent[] = [];` in `REMSession` with:

```typescript
private root?: REMAgent;
private readonly childAgents: REMAgent[] = [];
```

Add these APIs immediately before the run-lifecycle section:

```typescript
get rootAgent(): REMAgent | undefined {
  return this.root;
}

get childAgentCount(): number {
  return this.childAgents.length;
}

getOrCreateRootAgent(create: () => REMAgent): REMAgent {
  return (this.root ??= create());
}

addChildAgent(agent: REMAgent): void {
  this.childAgents.push(agent);
}
```

Add coordinated cancellation after `startRun()`:

```typescript
interruptRun(): void {
  this.runController?.abort();
  this.root?.interrupt();
}
```

This method deliberately does not call `finishRun()`: interrupt waits for the running Agent event stream to close normally, while reset explicitly finishes the session after interrupting it.

- [ ] **Step 4: Run the focused test and verify pass**

Run:

```bash
pnpm --filter rem-agent-bridge test -- rem-session.test.ts
```

Expected: PASS for all `REMSession` tests.

- [ ] **Step 5: Commit REMSession ownership**

```bash
git add packages/bridge/src/rem-session.ts packages/bridge/tests/rem-session.test.ts
git commit -m "refactor(bridge): make session own root agent"
```

### Task 2: Reuse the Root Agent in AgentsUniService

**Files:**

- Modify: `packages/bridge/src/agents-uni-service.ts:48-141`
- Modify: `packages/bridge/src/agents-uni-service.ts:169-173`
- Test: `packages/bridge/tests/agents-uni-service.test.ts`

- [ ] **Step 1: Write a failing same-session reuse integration test**

Append this test to the `AgentsUniService` suite:

```typescript
it('同一 session 连续 run 复用 root Agent 并延续 transcript', async () => {
  ctx = await createTestService();
  const s = await ctx.service.createSession(DEFAULT_WORKSPACE);

  const firstEnd = waitForBusEvent(
    ctx.service,
    (e) => e.type === 'session-end' && e.sessionId === s.sessionId,
  );
  await ctx.service.run(DEFAULT_WORKSPACE, s.sessionId, 'first');
  await firstEnd;
  const remSession = ctx.service.sessions.get(s.sessionId);
  const firstRoot = remSession?.rootAgent;

  const secondEnd = waitForBusEvent(
    ctx.service,
    (e) => e.type === 'session-end' && e.sessionId === s.sessionId,
  );
  await ctx.service.run(DEFAULT_WORKSPACE, s.sessionId, 'second');
  await secondEnd;

  expect(firstRoot).toBeDefined();
  expect(remSession?.rootAgent).toBe(firstRoot);
  const messages = await ctx.service.getMessages(DEFAULT_WORKSPACE, s.sessionId);
  expect(messages.filter((message) => message.role === 'user')).toHaveLength(2);
  expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(2);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --filter rem-agent-bridge test -- agents-uni-service.test.ts
```

Expected: FAIL because `AgentsUniService.run()` still creates a new root Agent on every call and still uses the removed mixed `agents` array.

- [ ] **Step 3: Lazily create and reuse the root Agent**

In `run()`, stop retaining the return value of `startRun()`:

```typescript
remSession.startRun();
```

Replace the unconditional root construction and `agents.push()` with:

```typescript
const remAgent = remSession.getOrCreateRootAgent(() => new REMAgent({
  di: this.di,
  runtimeConfig: this.runtimeConfig,
  session,
  workspace,
  workspaceRoot: workspace,
  agentId: 'root',
  sessionId,
  spawnChild: (childInput, toolCtx) =>
    this.spawnChild(remSession, 'root', childInput, toolCtx),
}));
this.agentService.run(remSession, remAgent, {
  content: input,
  timestamp: new Date(),
});
```

Do not pass `signal` to the reusable root Agent. A signal created for the first run would remain permanently bound to the Agent and cannot represent later runs.

- [ ] **Step 4: Separate child registration and root lookup**

In `spawnChild()`, replace the mixed-array ID and registration:

```typescript
const childAgentId =
  `${parentAgentId}.delegate-${remSession.childAgentCount + 1}`;
```

```typescript
remSession.addChildAgent(remAgent);
```

Update the control lookup:

```typescript
private runningRootAgent(sessionId: string): REMAgent {
  const remSession = this.sessions.get(sessionId);
  const root = remSession?.rootAgent;
  if (!remSession || remSession.status !== 'running' || !root) {
    throw new ServiceError('Session is not running', 409);
  }
  return root;
}
```

Update both callers:

```typescript
this.runningRootAgent(sessionId).steer(input);
```

```typescript
this.runningRootAgent(sessionId).followUp(input);
```

- [ ] **Step 5: Route cancellation through REMSession**

Replace the bodies of `interrupt()` and `reset()` after logging with:

```typescript
this.sessions.get(sessionId)?.interruptRun();
```

and:

```typescript
const remSession = this.sessions.get(sessionId);
remSession?.interruptRun();
remSession?.finishRun();
```

In `deleteSession()`, replace direct controller cancellation with:

```typescript
const remSession = this.sessions.get(sessionId);
remSession?.interruptRun();
this.sessions.remove(sessionId);
return this.translateNotFound(() => this.sessionService.delete(sessionId));
```

- [ ] **Step 6: Run bridge tests and verify pass**

Run:

```bash
pnpm --filter rem-agent-bridge test
```

Expected: PASS, including two sequential runs with the same root Agent reference and four persisted conversation messages.

- [ ] **Step 7: Commit root Agent reuse**

```bash
git add packages/bridge/src/agents-uni-service.ts packages/bridge/tests/agents-uni-service.test.ts
git commit -m "fix(bridge): reuse session root agent"
```

### Task 3: Verify Cross-Session Isolation and Full Repository Health

**Files:**

- Modify: `packages/bridge/tests/agents-uni-service.test.ts`

- [ ] **Step 1: Write a cross-session isolation test**

Append:

```typescript
it('不同 session 使用不同 root Agent', async () => {
  ctx = await createTestService();
  const first = await ctx.service.createSession(DEFAULT_WORKSPACE);
  const second = await ctx.service.createSession(DEFAULT_WORKSPACE);

  const firstEnd = waitForBusEvent(
    ctx.service,
    (e) => e.type === 'session-end' && e.sessionId === first.sessionId,
  );
  await ctx.service.run(DEFAULT_WORKSPACE, first.sessionId, 'first');
  await firstEnd;

  const secondEnd = waitForBusEvent(
    ctx.service,
    (e) => e.type === 'session-end' && e.sessionId === second.sessionId,
  );
  await ctx.service.run(DEFAULT_WORKSPACE, second.sessionId, 'second');
  await secondEnd;

  expect(ctx.service.sessions.get(first.sessionId)?.rootAgent).toBeDefined();
  expect(ctx.service.sessions.get(second.sessionId)?.rootAgent).toBeDefined();
  expect(ctx.service.sessions.get(first.sessionId)?.rootAgent)
    .not.toBe(ctx.service.sessions.get(second.sessionId)?.rootAgent);
});
```

- [ ] **Step 2: Run the bridge integration suite**

Run:

```bash
pnpm --filter rem-agent-bridge test -- agents-uni-service.test.ts
```

Expected: PASS, including same-session identity and cross-session isolation.

- [ ] **Step 3: Run full type checking**

Run:

```bash
pnpm typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: exit code 0 with all Vitest projects passing.

- [ ] **Step 5: Check module-size and diff hygiene**

Run:

```bash
wc -l packages/bridge/src/rem-session.ts packages/bridge/src/agents-uni-service.ts
git diff --check
git status --short
```

Expected:

- `rem-session.ts` remains below the 200-line implementation-file absolute limit.
- `agents-uni-service.ts` may remain above 200 lines because it was already 248 lines; this change must not introduce a new responsibility or materially increase its size.
- `git diff --check` exits with code 0.
- status lists only the intended implementation and test changes since the design/plan commits.

- [ ] **Step 6: Commit isolation coverage**

```bash
git add packages/bridge/tests/agents-uni-service.test.ts
git commit -m "test(bridge): cover root agent isolation"
```
