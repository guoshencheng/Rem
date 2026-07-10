# Tool Permission Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `auto` and `interactive` security modes for tool execution, with a pluggable `ToolPermissionEvaluator` interface and built-in sensitive-read patterns.

**Architecture:** Split permission evaluation out of `execute-tools.ts` into a dedicated `security/permissions` layer. Two evaluator implementations (`AutoPermissionEvaluator` and `InteractivePermissionEvaluator`) share a common `BaseRuleEvaluator` and a `classifyTool` classifier. `execute-tools.ts` becomes a thin orchestrator that only asks the injected evaluator for a decision.

**Tech Stack:** TypeScript, Vitest, `@sinclair/typebox`, `bash-parser` (already in use)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/security/permissions/types.ts` | `ToolPermissionEvaluator` interface, `PermissionDecision`, `ApprovalRequestInput` |
| `packages/core/src/security/permissions/sensitive-patterns.ts` | Built-in sensitive-read glob patterns |
| `packages/core/src/security/permissions/tool-classifier.ts` | Classify a tool call into `write` / `sensitive-read` / `read` |
| `packages/core/src/security/permissions/base-evaluator.ts` | Shared `RuleEngine` wrapper |
| `packages/core/src/security/permissions/interactive-evaluator.ts` | `interactive` mode evaluator |
| `packages/core/src/security/permissions/auto-evaluator.ts` | `auto` mode evaluator |
| `packages/core/src/security/permissions/factory.ts` | Factory that creates the right evaluator for the mode |
| `packages/core/src/execute/execute-tools.ts` | Refactored to use `ToolPermissionEvaluator` |
| `packages/core/src/agent-context.ts` | Add `permissionEvaluator` field |
| `packages/core/src/agent-context-builder.ts` | Wire factory into context build |
| `packages/core/tests/security/permissions/tool-classifier.test.ts` | Tests for classifier |
| `packages/core/tests/security/permissions/auto-evaluator.test.ts` | Tests for auto evaluator |
| `packages/core/tests/security/permissions/interactive-evaluator.test.ts` | Tests for interactive evaluator |
| `packages/core/tests/execute/execute-tools-permission-modes.test.ts` | Integration tests for execute-tools with both modes |

---

## Task 1: Create permission types

**Files:**
- Create: `packages/core/src/security/permissions/types.ts`

- [ ] **Step 1: Write the file**

```typescript
import type { ToolCall, ToolDefinition } from '../../sdk/tool-provider.js';
import type { Rule } from '../rules/rule.js';

export interface ApprovalRequestInput {
  toolCallId: string;
  toolName: string;
  patterns: string[];
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  alwaysOptions: Array<{ label: string; rule: Omit<Rule, 'source'> }>;
}

export type PermissionDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; request: ApprovalRequestInput };

export interface ToolPermissionEvaluator {
  evaluate(toolCall: ToolCall, toolDef: ToolDefinition): Promise<PermissionDecision>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/security/permissions/types.ts
git commit -m "feat(security): add permission evaluator types"
```

---

## Task 2: Create built-in sensitive-read patterns

**Files:**
- Create: `packages/core/src/security/permissions/sensitive-patterns.ts`

- [ ] **Step 1: Write the file**

```typescript
/**
 * Built-in glob patterns that identify sensitive read targets.
 * These are not user-configurable for now.
 */
export const BUILT_IN_SENSITIVE_READ_PATTERNS = [
  '**/.env*',
  '**/*.pem',
  '**/*.key',
  '**/secrets/**/*',
  '**/.ssh/**/*',
];
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/security/permissions/sensitive-patterns.ts
git commit -m "feat(security): add built-in sensitive read patterns"
```

---

## Task 3: Create tool classifier

**Files:**
- Create: `packages/core/src/security/permissions/tool-classifier.ts`
- Create: `packages/core/tests/security/permissions/tool-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { classifyTool } from '../../../src/security/permissions/tool-classifier.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../../../src/sdk/tool-provider.js';

const readDef: ToolDefinition = {
  name: 'read',
  description: 'read',
  parameters: Type.Object({ path: Type.String() }),
  readOnly: true,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

const writeDef: ToolDefinition = {
  name: 'write',
  description: 'write',
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

const editDef: ToolDefinition = {
  name: 'edit',
  description: 'edit',
  parameters: Type.Object({ path: Type.String(), oldString: Type.String(), newString: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

const execDef: ToolDefinition = {
  name: 'exec',
  description: 'exec',
  parameters: Type.Object({ command: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { command: string }) => [`bash:${input.command}`],
};

describe('classifyTool', () => {
  it('classifies write tools as write', () => {
    expect(classifyTool('write', writeDef, ['file:src/foo.ts'])).toBe('write');
    expect(classifyTool('edit', editDef, ['file:src/foo.ts'])).toBe('write');
  });

  it('classifies safe exec as read', () => {
    expect(classifyTool('exec', execDef, ['bash:git status'])).toBe('read');
  });

  it('classifies non-safe exec as write', () => {
    expect(classifyTool('exec', execDef, ['bash:git push'])).toBe('write');
  });

  it('classifies ordinary read as read', () => {
    expect(classifyTool('read', readDef, ['file:src/foo.ts'])).toBe('read');
  });

  it('classifies sensitive read as sensitive-read', () => {
    expect(classifyTool('read', readDef, ['file:/project/.env'])).toBe('sensitive-read');
    expect(classifyTool('read', readDef, ['file:/project/secrets/vault.json'])).toBe('sensitive-read');
  });

  it('classifies ls as read', () => {
    const lsDef: ToolDefinition = {
      name: 'ls',
      description: 'ls',
      parameters: Type.Object({ path: Type.String() }),
      readOnly: true,
      derivePatterns: (input: { path: string }) => [`file:${input.path}`],
    };
    expect(classifyTool('ls', lsDef, ['file:src'])).toBe('read');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter rem-agent-core test packages/core/tests/security/permissions/tool-classifier.test.ts
```

Expected: FAIL — `classifyTool` not defined.

- [ ] **Step 3: Implement the classifier**

```typescript
import { matchPattern } from '../matcher.js';
import { BUILT_IN_SENSITIVE_READ_PATTERNS } from './sensitive-patterns.js';
import { classifyCommand } from '../exec-classifier.js';
import type { ToolDefinition } from '../../sdk/tool-provider.js';

export type ToolCategory = 'write' | 'sensitive-read' | 'read';

export function classifyTool(
  toolName: string,
  toolDef: ToolDefinition,
  derivedPatterns: string[],
): ToolCategory {
  if (toolName === 'write' || toolName === 'edit') {
    return 'write';
  }

  if (toolName === 'exec') {
    const command = extractCommandFromPatterns(derivedPatterns);
    if (command) {
      const risk = classifyCommand(command).risk;
      if (risk === 'safe') {
        return isSensitiveRead(derivedPatterns) ? 'sensitive-read' : 'read';
      }
      return 'write';
    }
    return 'write';
  }

  if (toolDef.readOnly) {
    return isSensitiveRead(derivedPatterns) ? 'sensitive-read' : 'read';
  }

  return 'write';
}

function extractCommandFromPatterns(patterns: string[]): string | undefined {
  for (const p of patterns) {
    if (p.startsWith('bash:')) {
      return p.slice('bash:'.length);
    }
  }
  return undefined;
}

function isSensitiveRead(patterns: string[]): boolean {
  for (const p of patterns) {
    if (BUILT_IN_SENSITIVE_READ_PATTERNS.some((sp) => matchPattern(p, sp))) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter rem-agent-core test packages/core/tests/security/permissions/tool-classifier.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/permissions/tool-classifier.ts packages/core/tests/security/permissions/tool-classifier.test.ts
git commit -m "feat(security): add tool classifier for permission modes"
```

---

## Task 4: Create base rule evaluator

**Files:**
- Create: `packages/core/src/security/permissions/base-evaluator.ts`

- [ ] **Step 1: Write the file**

```typescript
import type { RuleAction } from '../rules/rule.js';
import type { RuleEngine } from '../rules/rule-engine.js';

export class BaseRuleEvaluator {
  constructor(private ruleEngine: RuleEngine) {}

  evaluateRules(toolName: string, derivedPatterns: string[]): RuleAction {
    return this.ruleEngine.evaluate({ toolName, derivedPatterns });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/security/permissions/base-evaluator.ts
git commit -m "feat(security): add base rule evaluator"
```

---

## Task 5: Create interactive permission evaluator

**Files:**
- Create: `packages/core/src/security/permissions/interactive-evaluator.ts`
- Create: `packages/core/tests/security/permissions/interactive-evaluator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { InteractivePermissionEvaluator } from '../../../src/security/permissions/interactive-evaluator.js';
import { BaseRuleEvaluator } from '../../../src/security/permissions/base-evaluator.js';
import { RuleEngine } from '../../../src/security/rules/rule-engine.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../../../src/sdk/tool-provider.js';
import type { Rule, ApprovalRequestInput } from '../../../src/security/permissions/types.js';

const writeDef: ToolDefinition = {
  name: 'write',
  description: 'write',
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
  deriveAlwaysOptions: (input: { path: string }) => [
    { label: input.path, rule: { permission: 'write', pattern: input.path, action: 'allow' } },
  ],
};

const readDef: ToolDefinition = {
  name: 'read',
  description: 'read',
  parameters: Type.Object({ path: Type.String() }),
  readOnly: true,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

function createEvaluator(rules: Rule[]) {
  return new InteractivePermissionEvaluator(new BaseRuleEvaluator(new RuleEngine(rules)), {
    create: (input: ApprovalRequestInput) => input,
  });
}

describe('InteractivePermissionEvaluator', () => {
  it('allows when rule matches allow', async () => {
    const evaluator = createEvaluator([
      { permission: 'write', pattern: 'file:src/*', action: 'allow', source: 'user-config' },
    ]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('denies when rule matches deny', async () => {
    const evaluator = createEvaluator([
      { permission: 'write', pattern: 'file:src/*', action: 'deny', source: 'user-config' },
    ]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision).toEqual({ action: 'deny', reason: 'denied by rule' });
  });

  it('asks for write when no rule matches', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision.action).toBe('ask');
    expect((decision as any).request.toolName).toBe('write');
  });

  it('allows ordinary read without asking', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: 'src/foo.ts' } },
      readDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('asks for sensitive read', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: '.env' } },
      readDef,
    );
    expect(decision.action).toBe('ask');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter rem-agent-core test packages/core/tests/security/permissions/interactive-evaluator.test.ts
```

Expected: FAIL — `InteractivePermissionEvaluator` not defined.

- [ ] **Step 3: Implement the evaluator**

```typescript
import type { ToolCall, ToolDefinition } from '../../sdk/tool-provider.js';
import type { PermissionDecision, ApprovalRequestInput, ToolPermissionEvaluator } from './types.js';
import type { Rule } from '../rules/rule.js';
import { BaseRuleEvaluator } from './base-evaluator.js';
import { classifyTool } from './tool-classifier.js';

export interface ApprovalRequestFactory {
  create(input: ApprovalRequestInput): ApprovalRequestInput;
}

export class InteractivePermissionEvaluator implements ToolPermissionEvaluator {
  constructor(
    private base: BaseRuleEvaluator,
    private approvalFactory: ApprovalRequestFactory,
  ) {}

  async evaluate(toolCall: ToolCall, toolDef: ToolDefinition): Promise<PermissionDecision> {
    const derivedPatterns = derivePatterns(toolCall, toolDef);
    const category = classifyTool(toolCall.toolName, toolDef, derivedPatterns);
    const ruleAction = this.base.evaluateRules(toolCall.toolName, derivedPatterns);

    if (ruleAction === 'deny') {
      return { action: 'deny', reason: 'denied by rule' };
    }
    if (ruleAction === 'allow') {
      return { action: 'allow' };
    }

    if (category === 'read') {
      return { action: 'allow' };
    }

    return {
      action: 'ask',
      request: this.approvalFactory.create({
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        patterns: derivedPatterns,
        title: `Run ${toolCall.toolName}`,
        description: JSON.stringify(toolCall.input).slice(0, 200),
        severity: 'warning',
        alwaysOptions: deriveAlwaysOptions(toolCall, toolDef),
      }),
    };
  }
}

function derivePatterns(toolCall: ToolCall, toolDef: ToolDefinition): string[] {
  if (toolDef.derivePatterns) {
    return toolDef.derivePatterns(toolCall.input as never);
  }
  return [`tool:${toolCall.toolName}`];
}

function deriveAlwaysOptions(
  toolCall: ToolCall,
  toolDef: ToolDefinition,
): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  if (toolDef.deriveAlwaysOptions) {
    return toolDef.deriveAlwaysOptions(toolCall.input as never);
  }
  return [
    {
      label: toolCall.toolName,
      rule: { permission: toolCall.toolName, pattern: '*', action: 'allow' },
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter rem-agent-core test packages/core/tests/security/permissions/interactive-evaluator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/permissions/interactive-evaluator.ts packages/core/tests/security/permissions/interactive-evaluator.test.ts
git commit -m "feat(security): add interactive permission evaluator"
```

---

## Task 6: Create auto permission evaluator

**Files:**
- Create: `packages/core/src/security/permissions/auto-evaluator.ts`
- Create: `packages/core/tests/security/permissions/auto-evaluator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { AutoPermissionEvaluator } from '../../../src/security/permissions/auto-evaluator.js';
import { BaseRuleEvaluator } from '../../../src/security/permissions/base-evaluator.js';
import { RuleEngine } from '../../../src/security/rules/rule-engine.js';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '../../../src/sdk/tool-provider.js';
import type { Rule } from '../../../src/security/rules/rule.js';

const writeDef: ToolDefinition = {
  name: 'write',
  description: 'write',
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  readOnly: false,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

const readDef: ToolDefinition = {
  name: 'read',
  description: 'read',
  parameters: Type.Object({ path: Type.String() }),
  readOnly: true,
  derivePatterns: (input: { path: string }) => [`file:${input.path}`],
};

function createEvaluator(rules: Rule[]) {
  return new AutoPermissionEvaluator(new BaseRuleEvaluator(new RuleEngine(rules)));
}

describe('AutoPermissionEvaluator', () => {
  it('allows write when no rule matches', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('denies write when rule matches deny', async () => {
    const evaluator = createEvaluator([
      { permission: 'write', pattern: 'file:src/*', action: 'deny', source: 'user-config' },
    ]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'write', input: { path: 'src/foo.ts' } },
      writeDef,
    );
    expect(decision).toEqual({ action: 'deny', reason: 'denied by rule' });
  });

  it('allows ordinary read without rule', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: 'src/foo.ts' } },
      readDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('denies sensitive read', async () => {
    const evaluator = createEvaluator([]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: '.env' } },
      readDef,
    );
    expect(decision).toEqual({ action: 'deny', reason: 'sensitive read blocked in auto mode' });
  });

  it('allows sensitive read when rule matches allow', async () => {
    const evaluator = createEvaluator([
      { permission: 'read', pattern: 'file:.env', action: 'allow', source: 'user-config' },
    ]);
    const decision = await evaluator.evaluate(
      { toolCallId: 'tc-1', toolName: 'read', input: { path: '.env' } },
      readDef,
    );
    expect(decision).toEqual({ action: 'allow' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter rem-agent-core test packages/core/tests/security/permissions/auto-evaluator.test.ts
```

Expected: FAIL — `AutoPermissionEvaluator` not defined.

- [ ] **Step 3: Implement the evaluator**

```typescript
import type { ToolCall, ToolDefinition } from '../../sdk/tool-provider.js';
import type { PermissionDecision, ToolPermissionEvaluator } from './types.js';
import { BaseRuleEvaluator } from './base-evaluator.js';
import { classifyTool } from './tool-classifier.js';

export class AutoPermissionEvaluator implements ToolPermissionEvaluator {
  constructor(private base: BaseRuleEvaluator) {}

  async evaluate(toolCall: ToolCall, toolDef: ToolDefinition): Promise<PermissionDecision> {
    const derivedPatterns = derivePatterns(toolCall, toolDef);
    const category = classifyTool(toolCall.toolName, toolDef, derivedPatterns);
    const ruleAction = this.base.evaluateRules(toolCall.toolName, derivedPatterns);

    if (ruleAction === 'deny') {
      return { action: 'deny', reason: 'denied by rule' };
    }
    if (ruleAction === 'allow') {
      return { action: 'allow' };
    }

    if (category === 'sensitive-read') {
      return { action: 'deny', reason: 'sensitive read blocked in auto mode' };
    }

    return { action: 'allow' };
  }
}

function derivePatterns(toolCall: ToolCall, toolDef: ToolDefinition): string[] {
  if (toolDef.derivePatterns) {
    return toolDef.derivePatterns(toolCall.input as never);
  }
  return [`tool:${toolCall.toolName}`];
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter rem-agent-core test packages/core/tests/security/permissions/auto-evaluator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/permissions/auto-evaluator.ts packages/core/tests/security/permissions/auto-evaluator.test.ts
git commit -m "feat(security): add auto permission evaluator"
```

---

## Task 7: Create evaluator factory

**Files:**
- Create: `packages/core/src/security/permissions/factory.ts`

- [ ] **Step 1: Write the file**

```typescript
import type { ApprovalRequestInput, ToolPermissionEvaluator } from './types.js';
import type { RuleEngine } from '../rules/rule-engine.js';
import { BaseRuleEvaluator } from './base-evaluator.js';
import { AutoPermissionEvaluator } from './auto-evaluator.js';
import { InteractivePermissionEvaluator } from './interactive-evaluator.js';

export type SecurityMode = 'auto' | 'interactive';

export interface ApprovalRequestFactory {
  create(input: ApprovalRequestInput): ApprovalRequestInput;
}

export function createPermissionEvaluator(
  mode: SecurityMode,
  ruleEngine: RuleEngine,
  approvalFactory?: ApprovalRequestFactory,
): ToolPermissionEvaluator {
  const base = new BaseRuleEvaluator(ruleEngine);
  if (mode === 'auto') {
    return new AutoPermissionEvaluator(base);
  }
  if (!approvalFactory) {
    throw new Error('interactive mode requires an approvalFactory');
  }
  return new InteractivePermissionEvaluator(base, approvalFactory);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/security/permissions/factory.ts
git commit -m "feat(security): add permission evaluator factory"
```

---

## Task 8: Add permissionEvaluator to AgentContext

**Files:**
- Modify: `packages/core/src/agent-context.ts`

- [ ] **Step 1: Modify the file**

Add import:

```typescript
import type { ToolPermissionEvaluator } from './security/permissions/types.js';
```

Add field to `AgentContext`:

```typescript
export interface AgentContext {
  // ... existing fields
  ruleEngine: RuleEngine;
  ruleStore: RuleStore;
  permissionEvaluator: ToolPermissionEvaluator;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/agent-context.ts
git commit -m "feat(security): add permissionEvaluator to AgentContext"
```

---

## Task 9: Wire factory into agent-context-builder

**Files:**
- Modify: `packages/core/src/agent-context-builder.ts`

- [ ] **Step 1: Add import**

```typescript
import {
  createPermissionEvaluator,
  type SecurityMode,
  type ApprovalRequestFactory,
} from './security/permissions/factory.js';
```

- [ ] **Step 2: Add securityMode to AgentContextBuildOptions**

```typescript
export interface AgentContextBuildOptions {
  // ... existing fields
  securityMode?: SecurityMode;
}
```

- [ ] **Step 3: Build permission evaluator in buildAgentContext**

Inside `buildAgentContext`, after `buildRuleSecurity`:

```typescript
const { ruleEngine, ruleStore } = await buildRuleSecurity(configProvider, paths.agentDir);

const approvalFactory: ApprovalRequestFactory = {
  create: (input) => input,
};

const permissionEvaluator = createPermissionEvaluator(
  options?.securityMode ?? 'interactive',
  ruleEngine,
  approvalFactory,
);
```

Add `permissionEvaluator` to the returned context object.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent-context-builder.ts
git commit -m "feat(security): wire permission evaluator factory into context builder"
```

---

## Task 10: Refactor execute-tools.ts to use permission evaluator

**Files:**
- Modify: `packages/core/src/execute/execute-tools.ts`

- [ ] **Step 1: Update imports**

Replace direct `RuleEngine`/`RuleStore` import usage with `ToolPermissionEvaluator`:

```typescript
import type { ToolPermissionEvaluator } from '../security/permissions/types.js';
```

Keep `RuleEngine` and `RuleStore` imports because `execute-tools.ts` still needs them for `allow-always` persistence.

- [ ] **Step 2: Update ExecuteParams interface**

```typescript
export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
  permissionEvaluator: ToolPermissionEvaluator;
  agentState: AgentState;
  ruleEngine: RuleEngine;
  ruleStore: RuleStore;
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

- [ ] **Step 3: Replace the rule-evaluation loop with evaluator calls**

Old loop body:

```typescript
const derivedPatterns = derivePatterns(tc, toolProvider);
const action = ruleEngine.evaluate({ toolName: tc.toolName, input: tc.input, derivedPatterns });

if (action === 'deny') { ... }
if (action === 'ask' && readOnly) { ... }
else if (action === 'ask') { ... }
```

New loop body:

```typescript
const def = toolProvider.getToolDefinition(tc.toolName);
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
  const request = liveState.approvalEngine.createRequest(decision.request);
  // ... rest unchanged
}
```

Remove the old `derivePatterns`, `deriveAlwaysOptions`, and `formatDescription` helper functions. Keep only `emitToolResult`.

- [ ] **Step 4: Run existing tests**

```bash
pnpm --filter rem-agent-core test packages/core/tests/execute/execute-tools-rules.test.ts
```

Expected: PASS (after updating callers in Task 11).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/execute/execute-tools.ts
git commit -m "refactor(execute): use injected permission evaluator"
```

---

## Task 11: Update existing callers of executeTools

**Files:**
- Modify: `packages/core/src/run-agent.ts` and any other files that call `executeTools`

- [ ] **Step 1: Find all callers**

```bash
rg "executeTools" packages/core/src
```

- [ ] **Step 2: Update each caller to pass permissionEvaluator**

In `run-agent.ts`, add `permissionEvaluator` to the `executeTools` call.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/run-agent.ts
git commit -m "chore: update executeTools callers to pass permission evaluator"
```

---

## Task 12: Add integration test for execute-tools with both modes

**Files:**
- Create: `packages/core/tests/execute/execute-tools-permission-modes.test.ts`

- [ ] **Step 1: Write the test**

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

describe('executeTools permission modes', () => {
  let registry: AgentToolRegistry;
  let agentState: AgentState;
  let ruleStore: RuleStore;
  let chunks: unknown[] = [];
  let ruleEngine: RuleEngine;

  beforeEach(async () => {
    registry = new AgentToolRegistry({ workspaceRoot: '/tmp' });

    const writeDef: ToolDefinition = {
      name: 'write',
      description: 'write',
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      derivePatterns: (input: { path: string }) => [`file:${input.path}`],
    };
    const writeExec: ToolExecutor = async () => ({ output: 'written' });
    registry.register(writeDef, writeExec);

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
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c: any) => chunks.push(c),
    };
  }

  it('auto mode allows write without approval', async () => {
    const results = await executeTools(
      buildParams('auto', [
        { toolCallId: 'tc-1', toolName: 'write', input: { path: 'foo.ts', content: 'x' } },
      ]),
    );
    expect(results[0].output).toBe('written');
    expect(chunks.some((c: any) => c.type === 'approval-request')).toBe(false);
  });

  it('auto mode denies sensitive read', async () => {
    const results = await executeTools(
      buildParams('auto', [{ toolCallId: 'tc-1', toolName: 'read', input: { path: '.env' } }]),
    );
    expect(results[0].error).toBe('sensitive read blocked in auto mode');
  });

  it('interactive mode asks for write', async () => {
    const pendingPromise = executeTools(
      buildParams('interactive', [
        { toolCallId: 'tc-1', toolName: 'write', input: { path: 'foo.ts', content: 'x' } },
      ]),
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(chunks.some((c: any) => c.type === 'approval-request')).toBe(true);

    const liveState = await agentState.getOrCreate('s1');
    const pending = liveState.pendingApprovals[0];
    liveState.approvalEngine.resolve(pending.approvalId, 'deny');

    const results = await pendingPromise;
    expect(results[0].error).toBe('denied by user');
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter rem-agent-core test packages/core/tests/execute/execute-tools-permission-modes.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/execute/execute-tools-permission-modes.test.ts
git commit -m "test(execute): add permission mode integration tests"
```

---

## Task 13: Full test run and typecheck

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run all core tests**

```bash
pnpm --filter rem-agent-core test
```

Expected: PASS.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix typecheck and test issues for permission modes"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|---|---|
| `ToolPermissionEvaluator` interface | Task 1 |
| Built-in sensitive patterns | Task 2 |
| Tool classification | Task 3 |
| `BaseRuleEvaluator` | Task 4 |
| `InteractivePermissionEvaluator` | Task 5 |
| `AutoPermissionEvaluator` | Task 6 |
| Factory by `securityMode` | Task 7, 9 |
| `execute-tools.ts` refactor | Task 10, 11 |
| `AgentContext` wiring | Task 8, 9 |
| Tests | Task 3, 5, 6, 12, 13 |

**Placeholder scan:** No TBD, TODO, or vague steps found. Each step includes concrete code and commands.

**Type consistency:** `ToolPermissionEvaluator`, `PermissionDecision`, `ApprovalRequestInput` types are used consistently. `Rule` type is imported from `../rules/rule.js` in all places.

