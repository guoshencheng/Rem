# REMAgent Structure Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Core's module-structure check fully green by reducing `REMAgent` to execution/lifecycle orchestration and relocating the built-in todo capability out of the plugin layer without changing public behavior.

**Architecture:** `REMAgent` continues to own transcript, queues, abort state, and loop event ingestion. A focused loop-parameter assembler resolves configuration, prompt, tools, compression, model, and stream function. Archive persistence and synthetic failure-message construction become small runtime helpers. The `todowrite` definition/executor moves beside the todo service under `capabilities/todo`, so Agent orchestration no longer imports a concrete plugin implementation.

**Tech Stack:** TypeScript, pi-ai, pi-agent-core, TypeBox, Vitest, pnpm

---

## File Structure

- Create `packages/core/src/agent/rem-agent-params.ts`: public construction/status types only.
- Create `packages/core/src/runtime/agent-loop-assembler.ts`: lazy loop input assembly and tool/compression wiring.
- Create `packages/core/src/runtime/conversation-archive.ts`: archive snapshot persistence.
- Create `packages/core/src/runtime/loop-failure.ts`: synthetic assistant failure event sequence.
- Create `packages/core/src/capabilities/todo/tool.ts`: built-in `todowrite` definition/executor, moved from plugins.
- Modify `packages/core/src/agent/rem-agent.ts`: retain lifecycle, transcript, queues, event ingestion, and public control methods.
- Modify `packages/core/src/index.ts`: preserve existing public todo-tool exports from their new location and export REMAgent types from the type module.
- Modify `packages/core/tests/rem-agent-assembly.test.ts`: verify concurrent lazy initialization is shared and tools remain available.
- Modify `packages/core/tests/rem-agent.test.ts`: keep behavioral regression coverage for errors, todo events, control queues, max turns, and children.
- Delete `packages/core/src/plugins/tool/builtin/todo-write.ts`: remove misplaced concrete capability module.

### Task 1: Lock Down Lazy Assembly Behavior

**Files:**

- Modify: `packages/core/tests/rem-agent-assembly.test.ts`

- [ ] **Step 1: Add a regression test for one-time lazy assembly**

Add a test that wraps `di.configProvider.resolveAgent` with a call counter, constructs one `REMAgent`, invokes `run()` twice sequentially, and expects configuration resolution to occur once while both runs finish.

```typescript
it('多个 run 复用同一次惰性 loop 装配', async () => {
  const { di, runtimeConfig } = await createFakeAssembly();
  const original = di.configProvider.resolveAgent.bind(di.configProvider);
  let resolutions = 0;
  di.configProvider.resolveAgent = (...args) => {
    resolutions += 1;
    return original(...args);
  };
  const agent = new REMAgent({
    di,
    runtimeConfig,
    session: fakeSession(),
    workspace: 'default',
    agentId: 'root',
  });

  for await (const _event of agent.run({ content: 'first' })) {}
  for await (const _event of agent.run({ content: 'second' })) {}

  expect(resolutions).toBe(1);
});
```

If the fake provider's method is readonly, use a small forwarding `ConfigProvider` object instead of mutation; preserve the same assertion.

- [ ] **Step 2: Run the focused test before refactoring**

Run:

```bash
pnpm vitest run packages/core/tests/rem-agent-assembly.test.ts
```

Expected: the new regression test passes against current behavior. This is a characterization test; the structural checker supplies the failing baseline for the refactor.

- [ ] **Step 3: Record the current structural failures**

Run:

```bash
pnpm --filter rem-agent-core check-structure
```

Expected: non-zero exit reporting only `agent/rem-agent.ts` over 200 lines and the `agent -> plugins` import.

### Task 2: Move the Todo Tool into Its Core Capability

**Files:**

- Create: `packages/core/src/capabilities/todo/tool.ts`
- Modify: `packages/core/src/index.ts`
- Delete: `packages/core/src/plugins/tool/builtin/todo-write.ts`

- [ ] **Step 1: Move the todo schemas and tool factories without semantic changes**

Create `capabilities/todo/tool.ts` with the complete contents of the old built-in tool module, adjusting imports to:

```typescript
import type { ToolContext, ToolDefinition, ToolExecutor } from '../../sdk/tool-provider.js';
import type { RemMetaEvent } from '../../agent/types.js';
import type { TodoService } from './service.js';
```

Remove an unused `ToolContext` import if TypeScript confirms it remains unused. Keep the tool name, schema, descriptions, validation delegation, emitted `todo-updated` event, and return details identical.

- [ ] **Step 2: Preserve the public API export**

Change `packages/core/src/index.ts` from:

```typescript
export { createTodoWriteToolDefinition, createTodoWriteToolExecutor } from './plugins/tool/builtin/todo-write.js'
```

to:

```typescript
export { createTodoWriteToolDefinition, createTodoWriteToolExecutor } from './capabilities/todo/tool.js'
```

- [ ] **Step 3: Delete the old concrete plugin module and find stale imports**

Delete `packages/core/src/plugins/tool/builtin/todo-write.ts`, then run:

```bash
rg -n "plugins/tool/builtin/todo-write|todo-write\.js" packages/core/src packages/core/tests
```

Expected: no stale old-path imports after Task 3 updates `REMAgent` through the assembler.

### Task 3: Extract Loop Assembly and Runtime Helpers

**Files:**

- Create: `packages/core/src/agent/rem-agent-params.ts`
- Create: `packages/core/src/runtime/conversation-archive.ts`
- Create: `packages/core/src/runtime/loop-failure.ts`
- Create: `packages/core/src/runtime/agent-loop-assembler.ts`
- Modify: `packages/core/src/agent/rem-agent.ts`

- [ ] **Step 1: Extract public construction types**

Move `REMAgentStatus` and `REMAgentParams` into `agent/rem-agent-params.ts`. Keep every property and comment contract, including optional `signal`, `spawnChild`, system-prompt override, and max-turn override. Import these types back into `rem-agent.ts` and re-export them there for source-path compatibility:

```typescript
export type { REMAgentParams, REMAgentStatus } from './rem-agent-params.js';
```

- [ ] **Step 2: Extract archive persistence**

Create `runtime/conversation-archive.ts` with:

```typescript
export async function archiveConversation(
  archiveStore: ArchiveStore,
  sessionId: string,
  before: Message[],
): Promise<string>
```

Move the exact versioning, parent archive, timestamp, snapshot, and empty-summary behavior from `REMAgent.archiveConversation` into this helper.

- [ ] **Step 3: Extract synthetic loop-failure emission**

Create `runtime/loop-failure.ts` with a function accepting `error`, `aborted`, optional model identity, and an `emit(AgentEvent)` callback. It must construct the same empty assistant message with zero usage and emit the same ordered events:

```text
message_start -> message_end -> turn_end -> agent_end
```

Keep stop reasons and error text unchanged.

- [ ] **Step 4: Create the loop-parameter assembler**

Create `runtime/agent-loop-assembler.ts` with focused interfaces:

```typescript
export interface AgentLoopAssemblyInput {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  session: Session;
  workspace: string;
  agentRoleId?: string;
  workspaceRoot?: string;
  systemPrompt?: string;
  maxTurns?: number;
  spawnChild?: SpawnChild;
  parentAgent: () => REMAgent;
  messages: () => Message[];
  drainSteering: () => Message[];
  drainFollowUp: () => Message[];
  emitMeta: (event: RemMetaEvent) => void;
}

export interface AssembledAgentLoop {
  context: AgentContext;
  config: AgentLoopConfig;
  streamFn: StreamFn;
  maxTurns: number | undefined;
}
```

Implement `assembleAgentLoop(input)` by moving the current configuration resolution, prompt resolution, delegate/todo overlay construction, compression transform, model lookup, loop config, stream function, and max-turn selection. Import todo factories from `capabilities/todo/tool.ts`; this runtime module may compose concrete Core capabilities, while `agent/` remains independent of `plugins/`.

Keep `convertToLlm`, sequential tool execution, API-key behavior, context-window threshold, and error text byte-for-byte equivalent where practical.

- [ ] **Step 5: Reduce REMAgent to lifecycle orchestration**

Replace its many assembly input fields with one retained `REMAgentParams` object or a small immutable assembly-input object. `ensureInitialized()` must memoize one promise and assign the returned assembly once. Retain in `REMAgent`:

- public identity/status/children fields and constructor
- transcript and pending queues
- `run`, `continue`, `steer`, `followUp`, `interrupt`
- `attachChild`, `emitMeta`
- run lifecycle and event ingestion
- context snapshot creation

Delegate archive, failure-message emission, and loop parameter construction to the new helpers. Keep `rem-agent.ts` at or below 200 physical lines.

- [ ] **Step 6: Update root exports for moved types**

Update `packages/core/src/index.ts` to export `REMAgent` from `rem-agent.ts` and `REMAgentStatus` / `REMAgentParams` from `rem-agent-params.ts`. Existing package-root imports must continue compiling.

### Task 4: Verify Behavior and Boundaries

**Files:**

- Verify: `packages/core/tests/rem-agent.test.ts`
- Verify: `packages/core/tests/rem-agent-assembly.test.ts`
- Verify: `packages/core/tests/delegate-task.test.ts`
- Verify: all Core source modules

- [ ] **Step 1: Run focused REMAgent tests**

Run:

```bash
pnpm vitest run \
  packages/core/tests/rem-agent.test.ts \
  packages/core/tests/rem-agent-assembly.test.ts \
  packages/core/tests/delegate-task.test.ts
```

Expected: all tests pass, including todo meta events, child attachment, lazy failure handling, queues, abort, and max-turn behavior.

- [ ] **Step 2: Run Core typecheck and structural checks**

Run:

```bash
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core check-structure
```

Expected: both pass; every implementation file is at most 200 lines and no forbidden dependency is reported.

- [ ] **Step 3: Run the full Core verification suite**

Run:

```bash
pnpm --filter rem-agent-core build
pnpm test
```

Expected: build and all Core tests pass.

- [ ] **Step 4: Review the final diff for semantic drift**

Run:

```bash
git diff --check
git diff --stat
git status --short
```

Expected: no whitespace errors; changes are limited to the planned Core modules, tests, public exports, and this plan.

- [ ] **Step 5: Commit the completed refactor**

Run:

```bash
git add packages/core docs/superpowers/plans/2026-07-31-rem-agent-structure-refactor.md
git commit -m "refactor: separate agent runtime assembly"
```

Expected: commit succeeds on `main` and the worktree is clean.
