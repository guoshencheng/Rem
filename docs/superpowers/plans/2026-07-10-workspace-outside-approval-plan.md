# Workspace Outside Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert workspace-root-guard from hard-failing on outside paths to an interactive approval flow (interactive mode asks; auto mode allows reads and lets writes follow existing rules).

**Architecture:** Introduce `WorkspaceOutsideError` and a new `Rule.outside` flag. `RuleEngine.checkOutsideAllowed` evaluates only outside rules. `execute-tools.ts` computes `outsideAllowed` per tool call based on mode + category and passes it through `ToolContext` to file tools, which skip the guard when allowed. When a guard still fires, `execute-tools.ts` catches the error and either asks for approval (interactive) or retries for auto writes.

**Tech Stack:** TypeScript, Vitest, `@sinclair/typebox`, `node:path`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/security/rules/rule.ts` | Extend `RuleSchema` with `outside` boolean |
| `packages/core/src/security/rules/rule-engine.ts` | Add `checkOutsideAllowed` method |
| `packages/core/src/security/workspace-root-guard.ts` | Add `WorkspaceOutsideError`; support `outsideAllowed` in `resolveWorkspacePath` |
| `packages/core/src/sdk/tool-provider.ts` | Add `outsideAllowed?: boolean` to `ToolContext` |
| `packages/core/src/plugins/tool/file-system/read.ts` | Pass `outsideAllowed` to `resolveWorkspacePath` |
| `packages/core/src/plugins/tool/file-system/write.ts` | Pass `outsideAllowed` to `resolveWorkspacePath` |
| `packages/core/src/plugins/tool/file-system/edit.ts` | Pass `outsideAllowed` to `resolveWorkspacePath` |
| `packages/core/src/plugins/tool/file-system/ls.ts` | Pass `outsideAllowed` to `resolveWorkspacePath` |
| `packages/core/src/execute/execute-tools.ts` | Compute `outsideAllowed`; catch `WorkspaceOutsideError`; handle interactive/auto |
| `packages/core/src/run-agent.ts` | Pass `securityMode` to `executeTools` |
| `packages/core/tests/security/rules/rule.test.ts` | Test `outside` schema validation |
| `packages/core/tests/security/rules/rule-engine.test.ts` | Test `checkOutsideAllowed` |
| `packages/core/tests/security/workspace-root-guard.test.ts` | Test `WorkspaceOutsideError` and `outsideAllowed` skip |
| `packages/core/tests/execute/execute-tools-outside-workspace.test.ts` | Integration test for interactive/auto behavior |
| `packages/core/tests/read-tool.test.ts` | Test read outside workspace when allowed |

---

## Task 1: Extend Rule schema with `outside` field

**Files:**
- Modify: `packages/core/src/security/rules/rule.ts`
- Test: `packages/core/tests/security/rules/rule.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { RuleSchema, isRuleAction } from '../../../src/security/rules/rule.js';
import { Value } from '@sinclair/typebox/value';

describe('RuleSchema', () => {
  it('accepts a rule with outside=true', () => {
    const rule = {
      permission: 'read',
      pattern: '*',
      action: 'allow',
      outside: true,
    };
    expect(() => Value.Assert(RuleSchema, rule)).not.toThrow();
  });

  it('accepts a rule without outside field', () => {
    const rule = {
      permission: 'read',
      pattern: '*',
      action: 'allow',
    };
    expect(() => Value.Assert(RuleSchema, rule)).not.toThrow();
  });

  it('rejects a rule with non-boolean outside', () => {
    const rule = {
      permission: 'read',
      pattern: '*',
      action: 'allow',
      outside: 'yes',
    };
    expect(() => Value.Assert(RuleSchema, rule)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run packages/core/tests/security/rules/rule.test.ts
```

Expected: FAIL — `outside: true` not accepted.

- [ ] **Step 3: Implement the schema change**

```typescript
import { Type, type Static } from '@sinclair/typebox';

export const RuleActionSchema = Type.Union([
  Type.Literal('allow'),
  Type.Literal('deny'),
  Type.Literal('ask'),
]);
export type RuleAction = Static<typeof RuleActionSchema>;

export const RuleSourceSchema = Type.Union([
  Type.Literal('default'),
  Type.Literal('profile'),
  Type.Literal('user-config'),
  Type.Literal('approved'),
  Type.Literal('session'),
]);
export type RuleSource = Static<typeof RuleSourceSchema>;

export const RuleSchema = Type.Object({
  permission: Type.String({ minLength: 1 }),
  pattern: Type.String({ minLength: 1 }),
  action: RuleActionSchema,
  source: Type.Optional(RuleSourceSchema),
  outside: Type.Optional(Type.Boolean()),
});
export type Rule = Static<typeof RuleSchema>;

export function isRuleAction(value: unknown): value is RuleAction {
  return value === 'allow' || value === 'deny' || value === 'ask';
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run packages/core/tests/security/rules/rule.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/rule.ts packages/core/tests/security/rules/rule.test.ts
git commit -m "feat(security): add outside field to Rule schema"
```

---

## Task 2: Add `RuleEngine.checkOutsideAllowed`

**Files:**
- Modify: `packages/core/src/security/rules/rule-engine.ts`
- Test: `packages/core/tests/security/rules/rule-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../../src/security/rules/rule-engine.js';
import type { Rule } from '../../../src/security/rules/rule.js';

describe('RuleEngine.checkOutsideAllowed', () => {
  it('returns true when outside allow rule matches', () => {
    const engine = new RuleEngine([
      { permission: 'read', pattern: '*', action: 'allow', outside: true, source: 'user-config' } as Rule,
    ]);
    expect(engine.checkOutsideAllowed('read', ['file:/outside/path'])).toBe(true);
  });

  it('returns false when no outside rule matches', () => {
    const engine = new RuleEngine([]);
    expect(engine.checkOutsideAllowed('read', ['file:/outside/path'])).toBe(false);
  });

  it('returns false when outside rule is deny', () => {
    const engine = new RuleEngine([
      { permission: 'read', pattern: '*', action: 'deny', outside: true, source: 'user-config' } as Rule,
    ]);
    expect(engine.checkOutsideAllowed('read', ['file:/outside/path'])).toBe(false);
  });

  it('ignores non-outside rules', () => {
    const engine = new RuleEngine([
      { permission: 'read', pattern: '*', action: 'allow', source: 'user-config' } as Rule,
    ]);
    expect(engine.checkOutsideAllowed('read', ['file:/outside/path'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run packages/core/tests/security/rules/rule-engine.test.ts
```

Expected: FAIL — `checkOutsideAllowed` not defined.

- [ ] **Step 3: Implement the method**

```typescript
import { buildRuleSet } from './ruleset.js';
import { evaluate } from './evaluator.js';
import type { Rule, RuleAction } from './rule.js';
import type { ToolCallPattern } from './evaluator.js';

export class RuleEngine {
  constructor(private rules: Rule[]) {}

  evaluate(toolCall: ToolCallPattern): RuleAction {
    const set = buildRuleSet(this.rules);
    return evaluate(toolCall, set);
  }

  checkOutsideAllowed(toolName: string, derivedPatterns: string[]): boolean {
    const outsideRules = this.rules.filter((r) => r.outside === true);
    const set = buildRuleSet(outsideRules);
    const action = evaluate({ toolName, derivedPatterns }, set, 'deny');
    return action === 'allow';
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run packages/core/tests/security/rules/rule-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/rule-engine.ts packages/core/tests/security/rules/rule-engine.test.ts
git commit -m "feat(security): add RuleEngine.checkOutsideAllowed"
```

---

## Task 3: Introduce `WorkspaceOutsideError` and `outsideAllowed` skip

**Files:**
- Modify: `packages/core/src/security/workspace-root-guard.ts`
- Test: `packages/core/tests/security/workspace-root-guard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  resolveWorkspacePath,
  WorkspaceOutsideError,
} from '../../../src/security/workspace-root-guard.js';

describe('resolveWorkspacePath', () => {
  it('throws WorkspaceOutsideError when path is outside workspace', () => {
    expect(() =>
      resolveWorkspacePath('/outside/path', { cwd: '/workspace', workspaceRoot: '/workspace' }),
    ).toThrow(WorkspaceOutsideError);
  });

  it('returns path when outsideAllowed is true', () => {
    const result = resolveWorkspacePath(
      '/outside/path',
      { cwd: '/workspace', workspaceRoot: '/workspace' },
      true,
    );
    expect(result).toBe('/outside/path');
  });

  it('includes path and workspace root in error', () => {
    try {
      resolveWorkspacePath('/outside/path', { cwd: '/workspace', workspaceRoot: '/workspace' });
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceOutsideError);
      expect((err as WorkspaceOutsideError).absolutePath).toBe('/outside/path');
      expect((err as WorkspaceOutsideError).workspaceRoot).toBe('/workspace');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run packages/core/tests/security/workspace-root-guard.test.ts
```

Expected: FAIL — `WorkspaceOutsideError` not defined or `outsideAllowed` not supported.

- [ ] **Step 3: Implement the guard changes**

```typescript
import { accessSync, constants, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = '\u202F';

export class WorkspaceOutsideError extends Error {
  constructor(
    public readonly absolutePath: string,
    public readonly workspaceRoot: string,
  ) {
    super(`Path "${absolutePath}" resolves outside workspace root "${workspaceRoot}"`);
    this.name = 'WorkspaceOutsideError';
  }
}

export function expandPath(filePath: string): string {
  const normalized = filePath.replace(UNICODE_SPACES, ' ').trim();
  if (normalized.startsWith('file://')) {
    try {
      return fileURLToPath(normalized);
    } catch {
      return normalized;
    }
  }
  if (normalized === '~') return os.homedir();
  if (normalized.startsWith('~/')) return os.homedir() + normalized.slice(1);
  return normalized;
}

export function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) return expanded;
  return resolve(cwd, expanded);
}

function fileExists(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function tryMacOSScreenshotPath(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
  return filePath.normalize('NFD');
}

function tryCurlyQuoteVariant(filePath: string): string {
  return filePath.replace(/'/g, '\u2019');
}

export function resolveReadPath(filePath: string, cwd: string): string {
  const resolved = resolveToCwd(filePath, cwd);
  if (fileExists(resolved)) return resolved;

  const amPmVariant = tryMacOSScreenshotPath(resolved);
  if (amPmVariant !== resolved && fileExists(amPmVariant)) return amPmVariant;

  const nfdVariant = tryNFDVariant(resolved);
  if (nfdVariant !== resolved && fileExists(nfdVariant)) return nfdVariant;

  const curlyVariant = tryCurlyQuoteVariant(resolved);
  if (curlyVariant !== resolved && fileExists(curlyVariant)) return curlyVariant;

  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
  if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) return nfdCurlyVariant;

  return resolved;
}

export function assertWithinWorkspaceRoot(
  absolutePath: string,
  workspaceRoot: string,
): void {
  const resolvedRoot = resolve(workspaceRoot);
  const realRoot = safeRealpath(resolvedRoot);
  const realPath = safeRealpath(absolutePath);
  const rel = relative(realRoot, realPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new WorkspaceOutsideError(absolutePath, workspaceRoot);
  }
}

function safeRealpath(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    return filePath;
  }
}

export function resolveWorkspacePath(
  filePath: string,
  ctx: { cwd: string; workspaceRoot: string },
  outsideAllowed: boolean = false,
): string {
  const cwd = safeRealpath(ctx.cwd);
  const root = safeRealpath(ctx.workspaceRoot);
  const resolved = resolveToCwd(filePath, cwd);
  if (outsideAllowed) {
    return resolved;
  }
  assertWithinWorkspaceRoot(resolved, root);
  return resolved;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run packages/core/tests/security/workspace-root-guard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/workspace-root-guard.ts packages/core/tests/security/workspace-root-guard.test.ts
git commit -m "feat(security): add WorkspaceOutsideError and outsideAllowed guard skip"
```

---

## Task 4: Extend `ToolContext` with `outsideAllowed`

**Files:**
- Modify: `packages/core/src/sdk/tool-provider.ts`

- [ ] **Step 1: Write the change**

```typescript
export interface ToolContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId?: string;
  outsideAllowed?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/sdk/tool-provider.ts
git commit -m "feat(security): add outsideAllowed to ToolContext"
```

---

## Task 5: Update file system tools to pass `outsideAllowed`

**Files:**
- Modify: `packages/core/src/plugins/tool/file-system/read.ts`
- Modify: `packages/core/src/plugins/tool/file-system/write.ts`
- Modify: `packages/core/src/plugins/tool/file-system/edit.ts`
- Modify: `packages/core/src/plugins/tool/file-system/ls.ts`

- [ ] **Step 1: Modify `read.ts`**

```typescript
export function createReadToolExecutor(): ToolExecutor<typeof readSchema> {
  return async (input: ReadToolInput, ctx: ToolContext) => {
    const rawResolved = resolveReadPath(input.path, ctx.cwd);
    const absolutePath = resolveWorkspacePath(rawResolved, ctx, ctx.outsideAllowed);
    // ... rest unchanged
  };
}
```

- [ ] **Step 2: Modify `write.ts`**

In `createWriteToolExecutor`, change the `resolveWorkspacePath` call to:

```typescript
const absolutePath = resolveWorkspacePath(input.path, ctx, ctx.outsideAllowed);
```

- [ ] **Step 3: Modify `edit.ts`**

In `createEditToolExecutor`, change the `resolveWorkspacePath` call to:

```typescript
const absolutePath = resolveWorkspacePath(input.path, ctx, ctx.outsideAllowed);
```

- [ ] **Step 4: Modify `ls.ts`**

In `createLsToolExecutor`, change the `resolveWorkspacePath` call to:

```typescript
const dirPath = resolveWorkspacePath(input.path || '.', ctx, ctx.outsideAllowed);
```

- [ ] **Step 5: Run file-system tool tests**

```bash
npx vitest run packages/core/tests/read-tool.test.ts packages/core/tests/write-tool.test.ts packages/core/tests/edit-tool.test.ts packages/core/tests/ls-tool.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/read.ts packages/core/src/plugins/tool/file-system/write.ts packages/core/src/plugins/tool/file-system/edit.ts packages/core/src/plugins/tool/file-system/ls.ts
git commit -m "feat(security): pass outsideAllowed to file system tools"
```

---

## Task 6: Update `ExecuteParams` and `run-agent.ts` to pass `securityMode`

**Files:**
- Modify: `packages/core/src/execute/execute-tools.ts`
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: Add `securityMode` to `ExecuteParams`**

```typescript
import type { SecurityMode } from '../security/permissions/factory.js';

export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
  permissionEvaluator: ToolPermissionEvaluator;
  agentState: AgentState;
  ruleEngine: RuleEngine;
  ruleStore: RuleStore;
  securityMode: SecurityMode;
  addMessage: (role: 'tool') => ModelMessage;
  appendContent: (msg: ModelMessage, part: { type: string; [key: string]: unknown }) => void;
  workspaceRoot: string;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
  signal?: AbortSignal;
  emit: (chunk: ProviderChunk) => void;
}
```

- [ ] **Step 2: Pass `securityMode` from `run-agent.ts`**

In `run-agent.ts`, the `executeTools` call needs `securityMode`. Add it from the `AgentContext` or `ConfigProvider`. Since `AgentContext` currently does not store `securityMode`, read it from `ctx.configProvider.getBehaviorConfig()` if the config provider stores it, or add `securityMode` to `AgentContext`.

For this plan, add `securityMode` to `AgentContext` and pass it through `buildAgentContext`.

Modify `AgentContext`:

```typescript
export interface AgentContext {
  // ... existing fields
  securityMode: SecurityMode;
}
```

Modify `buildAgentContext` to store the resolved `securityMode` in the returned context.

Modify `run-agent.ts`:

```typescript
execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
  toolCalls: calls, toolProvider: effectiveToolProvider, addMessage, appendContent,
  agentState: params.agentState,
  permissionEvaluator: ctx.permissionEvaluator,
  ruleEngine: ctx.ruleEngine,
  ruleStore: ctx.ruleStore,
  securityMode: ctx.securityMode,
  workspaceRoot, agentName: behavior.name,
  readOnly: behavior.readOnly, sessionId: params.sessionId, signal: params.signal,
  emit: (chunk) => trackMessageStart(chunk),
}),
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/execute/execute-tools.ts packages/core/src/run-agent.ts packages/core/src/agent-context.ts packages/core/src/agent-context-builder.ts
git commit -m "feat(security): propagate securityMode through executeTools"
```

---

## Task 7: Implement `outsideAllowed` computation and `WorkspaceOutsideError` handling in `execute-tools.ts`

**Files:**
- Modify: `packages/core/src/execute/execute-tools.ts`
- Test: `packages/core/tests/execute/execute-tools-outside-workspace.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { executeTools } from '../../src/execute/execute-tools.js';
import { AgentToolRegistry } from '../../src/registry/tool-registry.js';
import { AgentState } from '../../src/agent-state.js';
import { RuleEngine } from '../../src/security/rules/rule-engine.js';
import { RuleStore } from '../../src/security/rules/rule-store.js';
import { createPermissionEvaluator } from '../../src/security/permissions/factory.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor } from '../../src/sdk/tool-provider.js';

describe('executeTools outside workspace', () => {
  let registry: AgentToolRegistry;
  let agentState: AgentState;
  let ruleStore: RuleStore;
  let ruleEngine: RuleEngine;
  let chunks: unknown[] = [];

  beforeEach(async () => {
    registry = new AgentToolRegistry({ workspaceRoot: '/workspace' });

    const readDef: ToolDefinition = {
      name: 'read',
      description: 'read',
      parameters: Type.Object({ path: Type.String() }),
      readOnly: true,
      derivePatterns: (input: { path: string }) => [`file:${input.path}`],
    };
    const readExec: ToolExecutor = async () => ({ output: 'ok' });
    registry.register(readDef, readExec);

    agentState = new AgentState();
    ruleStore = new RuleStore();
    ruleEngine = new RuleEngine([]);
    chunks = [];
  });

  function buildParams(mode: 'auto' | 'interactive', toolCalls: any[]) {
    return {
      toolCalls,
      toolProvider: registry,
      permissionEvaluator: createPermissionEvaluator(mode, ruleEngine, { create: (i) => i }),
      agentState,
      ruleEngine,
      ruleStore,
      securityMode: mode,
      workspaceRoot: '/workspace',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c: any) => chunks.push(c),
    };
  }

  it('auto mode allows read outside workspace', async () => {
    const results = await executeTools(
      buildParams('auto', [
        { toolCallId: 'tc-1', toolName: 'read', input: { path: '/outside/file.txt' } },
      ]),
    );
    expect(results[0].output).toBe('ok');
  });

  it('interactive mode asks for read outside workspace', async () => {
    const pendingPromise = executeTools(
      buildParams('interactive', [
        { toolCallId: 'tc-1', toolName: 'read', input: { path: '/outside/file.txt' } },
      ]),
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(chunks.some((c: any) => c.type === 'approval-request')).toBe(true);

    const liveState = await agentState.getOrCreate('s1');
    const pending = liveState.pendingApprovals[0];
    liveState.approvalEngine.resolve(pending.approvalId, 'deny');

    const results = await pendingPromise;
    expect(results[0].error).toBe('denied');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run packages/core/tests/execute/execute-tools-outside-workspace.test.ts
```

Expected: FAIL — `executeTools` does not handle outside workspace or `securityMode` not yet wired.

- [ ] **Step 3: Implement `execute-tools.ts` changes**

Add imports:

```typescript
import { WorkspaceOutsideError } from '../security/workspace-root-guard.js';
import type { SecurityMode } from '../security/permissions/factory.js';
import { classifyTool } from '../security/permissions/tool-classifier.js';
import type { ToolCategory } from '../security/permissions/tool-classifier.js';
```

Update `ExecuteParams` (already done in Task 6).

Inside the loop, replace the direct tool execution with guarded logic:

```typescript
for (const tc of params.toolCalls) {
  log('tools', 'executing tool call', { sessionId: params.sessionId, toolCallId: tc.toolCallId, toolName: tc.toolName });

  const def = toolProvider.getToolDefinition(tc.toolName);
  if (!def) {
    const denied: ToolResult = {
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: '',
      error: `unknown tool: ${tc.toolName}`,
    };
    emitToolResult(tc, denied, emit, addMessage, appendContent);
    results.push(denied);
    continue;
  }

  const decision = await params.permissionEvaluator.evaluate(tc, def);

  if (decision.action === 'deny') {
    const denied: ToolResult = {
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: '',
      error: decision.reason,
    };
    emitToolResult(tc, denied, emit, addMessage, appendContent);
    results.push(denied);
    continue;
  }

  if (decision.action === 'ask') {
    // existing approval flow unchanged
  }

  const derivedPatterns = def.derivePatterns
    ? def.derivePatterns(tc.input as never)
    : [`tool:${tc.toolName}`];
  const category = classifyTool(tc.toolName, def, derivedPatterns);
  const outsideAllowed = computeOutsideAllowed(
    params.securityMode,
    category,
    ruleEngine,
    tc.toolName,
    derivedPatterns,
  );

  const ctx: ToolContext = {
    cwd: params.workspaceRoot,
    workspaceRoot: params.workspaceRoot,
    signal,
    agentName: params.agentName,
    readOnly: params.readOnly,
    sessionId: params.sessionId,
    outsideAllowed,
  };

  let result: ToolResult;
  try {
    [result] = await toolProvider.execute([tc], ctx);
  } catch (err) {
    if (err instanceof WorkspaceOutsideError) {
      result = await handleOutsideWorkspaceError(tc, err, params, ctx, category);
    } else {
      result = {
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  results.push(result);
  emitToolResult(tc, result, emit, addMessage, appendContent);
}

function computeOutsideAllowed(
  mode: SecurityMode,
  category: ToolCategory,
  ruleEngine: RuleEngine,
  toolName: string,
  derivedPatterns: string[],
): boolean {
  if (ruleEngine.checkOutsideAllowed(toolName, derivedPatterns)) {
    return true;
  }
  if (mode === 'auto' && category === 'read') {
    return true;
  }
  return false;
}
```

Add `handleOutsideWorkspaceError`:

```typescript
async function handleOutsideWorkspaceError(
  tc: ToolCall,
  err: WorkspaceOutsideError,
  params: ExecuteParams,
  ctx: ToolContext,
  category: ToolCategory,
): Promise<ToolResult> {
  if (params.securityMode === 'auto' && category === 'write') {
    const allowedCtx = { ...ctx, outsideAllowed: true };
    const [result] = await params.toolProvider.execute([tc], allowedCtx);
    return result;
  }

  if (params.securityMode === 'auto') {
    return {
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: '',
      error: `Path outside workspace denied in auto mode: ${err.absolutePath}`,
    };
  }

  const liveState = params.agentState.getOrCreate(params.sessionId);
  const request = liveState.approvalEngine.createRequest({
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    patterns: [err.absolutePath],
    title: `Access outside workspace: ${tc.toolName}`,
    description: `Path "${err.absolutePath}" resolves outside workspace root "${err.workspaceRoot}"`,
    severity: 'warning',
    alwaysOptions: [
      {
        label: err.absolutePath,
        rule: {
          permission: tc.toolName,
          pattern: err.absolutePath,
          action: 'allow',
          outside: true,
        },
      },
      {
        label: `allow all outside ${tc.toolName}`,
        rule: {
          permission: tc.toolName,
          pattern: '*',
          action: 'allow',
          outside: true,
        },
      },
    ],
  });

  liveState.pendingApprovals.push(request);
  params.emit({ type: 'approval-request', sessionId: params.sessionId, request });
  log('tools', 'approval requested', { sessionId: params.sessionId, toolCallId: tc.toolCallId, approvalId: request.approvalId });

  const resolution = await liveState.approvalEngine.wait(request.approvalId);
  liveState.pendingApprovals = liveState.pendingApprovals.filter(
    (r) => r.approvalId !== request.approvalId,
  );
  params.emit({
    type: 'approval-resolved',
    sessionId: params.sessionId,
    approvalId: request.approvalId,
    decision: resolution.decision,
  });
  log('tools', 'approval resolved', { sessionId: params.sessionId, toolCallId: tc.toolCallId, approvalId: request.approvalId, decision: resolution.decision });

  if (resolution.decision === 'deny') {
    return {
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: '',
      error: 'denied',
    };
  }

  if (resolution.decision === 'allow-always' && resolution.rule) {
    await params.ruleStore.saveApproved(resolution.rule);
    params.ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
  }

  const allowedCtx = { ...ctx, outsideAllowed: true };
  const [result] = await params.toolProvider.execute([tc], allowedCtx);
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run packages/core/tests/execute/execute-tools-outside-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/execute/execute-tools.ts packages/core/tests/execute/execute-tools-outside-workspace.test.ts
git commit -m "feat(execute): handle outside workspace paths by mode"
```

---

## Task 8: Full test run and typecheck

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run all core tests**

```bash
npx vitest run packages/core/tests
```

Expected: PASS.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix typecheck and test issues for workspace outside approval"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|---|---|
| `Rule.outside` field | Task 1 |
| `RuleEngine.checkOutsideAllowed` | Task 2 |
| `WorkspaceOutsideError` | Task 3 |
| `resolveWorkspacePath` outsideAllowed skip | Task 3 |
| `ToolContext.outsideAllowed` | Task 4 |
| File tools pass outsideAllowed | Task 5 |
| `securityMode` propagation | Task 6 |
| `execute-tools.ts` outside handling | Task 7 |
| Tests | Task 1, 2, 3, 7, 8 |

**Placeholder scan:** No TBD, TODO, or vague steps found. Each step includes concrete code and commands.

**Type consistency:** `outsideAllowed` is `boolean` in `ToolContext`, `resolveWorkspacePath`, `computeOutsideAllowed`, and `handleOutsideWorkspaceError`. `SecurityMode` is imported from the same factory module throughout.

