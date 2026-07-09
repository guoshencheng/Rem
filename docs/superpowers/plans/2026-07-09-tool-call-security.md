# Tool-Call Security Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Rem Agent's tool-call security into an OpenCode-style rule-based + ask system with local persisted approvals, pattern-level rules, no approval timeouts, and OpenClaw-inspired exec risk classification.

**Architecture:** Introduce a `security/rules` layer in `rem-agent-core` (`Rule`, `RuleSet`, `Evaluator`, `RuleStore`, `ProfileRegistry`, `CommandClassifier`), refactor `execute-tools.ts` to evaluate rules before execution, extend `ApprovalRequest` with `alwaysOptions`, and update `rem-agent-bridge` / `rem-agent-web` to render the new approval UX.

**Tech Stack:** TypeScript, Vitest, `bash-parser` (or equivalent shell AST parser), existing `@sinclair/typebox` for validation.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `packages/core/src/security/rules/rule.ts` | Core rule types and schema validation |
| `packages/core/src/security/rules/matcher.ts` | Glob/wildcard matching (`*`, `?`, `**`) |
| `packages/core/src/security/rules/ruleset.ts` | Merge rules from multiple sources with priority |
| `packages/core/src/security/rules/evaluator.ts` | Evaluate a tool call against rules, return `allow/deny/ask` |
| `packages/core/src/security/rules/rule-store.ts` | Read/write `~/.config/rem/permissions.json` |
| `packages/core/src/security/rules/profiles.ts` | Preset rulesets for `minimal`, `coding`, `messaging`, `full` |
| `packages/core/src/security/rules/errors.ts` | `ToolDeniedError` and related error types |
| `packages/core/src/security/exec-classifier.ts` | Parse exec commands with AST, classify risk, generate patterns |
| `packages/core/src/execute/approval-engine.ts` | Create requests, cascade approve/deny, manage pending state |
| `packages/core/tests/security/rules/evaluator.test.ts` | Evaluator unit tests |
| `packages/core/tests/security/rules/ruleset.test.ts` | RuleSet merge/priority tests |
| `packages/core/tests/security/rules/rule-store.test.ts` | RuleStore persistence tests |
| `packages/core/tests/security/exec-classifier.test.ts` | Command classification tests |
| `packages/core/tests/execute/approval-engine.test.ts` | Approval cascade/no-timeout tests |
| `packages/core/tests/execute/execute-tools-rules.test.ts` | End-to-end executeTools rule flow tests |

### Modified files

| File | Responsibility |
|---|---|
| `packages/core/src/sdk/tool-provider.ts` | Add `derivePatterns` / `alwaysOptions` hooks to `ToolDefinition` |
| `packages/core/src/sdk/agent-state-provider.ts` | Extend `ApprovalRequest` with `patterns` and `alwaysOptions`; remove `timeoutMs` |
| `packages/core/src/execute/approval-registry.ts` | Remove timeout behavior; add `rejectAllForSession` |
| `packages/core/src/execute/execute-tools.ts` | Replace hard-coded `isDangerous` check with rule evaluation |
| `packages/core/src/agent-state.ts` | Update `waitApproval` signature (no timeout); add cascade helpers |
| `packages/core/src/state.ts` | Keep `approvalRegistry`; update type imports |
| `packages/core/src/run-agent.ts` | Pass `RuleEngine` / `RuleStore` into `executeTools` |
| `packages/core/src/agent-context.ts` | Add `ruleStore` and `ruleEngine` to `AgentContext` |
| `packages/core/src/sdk/config-provider.ts` | Add `profile` / `sessionRules` to config |
| `packages/core/src/core-agent.ts` | Wire rule store + engine during context build |
| `packages/core/src/security/tool-policy-pipeline.ts` | Deprecate gradually; route existing policy fields into rules |
| `packages/core/src/plugins/tool/file-system/index.ts` | Register pattern derivations for fs/exec tools |
| `packages/bridge/src/agent.ts` | Update `resolveApproval` signature to accept optional rule |
| `packages/web/src/components/chat/approval-bar.tsx` | Render always-options dropdown |
| `packages/web/src/app/api/approvals/[id]/resolve/route.ts` | Accept `rule` in body for always decisions |
| `packages/web/src/lib/use-agents.ts` | Keep pending approval sync; no major change |

---

## Task 1: Rule schema and types

**Files:**
- Create: `packages/core/src/security/rules/rule.ts`
- Test: `packages/core/tests/security/rules/rule.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/security/rules/rule.test.ts
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { RuleSchema, isRuleAction } from '../../../src/security/rules/rule.js';

describe('rule schema', () => {
  it('validates a correct rule', () => {
    const rule = { permission: 'exec', pattern: 'git *', action: 'allow' };
    expect(Value.Check(RuleSchema, rule)).toBe(true);
  });

  it('rejects invalid action', () => {
    const rule = { permission: 'exec', pattern: '*', action: 'maybe' };
    expect(Value.Check(RuleSchema, rule)).toBe(false);
  });

  it('isRuleAction narrows types', () => {
    expect(isRuleAction('allow')).toBe(true);
    expect(isRuleAction('ask')).toBe(true);
    expect(isRuleAction('deny')).toBe(true);
    expect(isRuleAction('once')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/rule.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/security/rules/rule.ts
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
});
export type Rule = Static<typeof RuleSchema>;

export function isRuleAction(value: unknown): value is RuleAction {
  return value === 'allow' || value === 'deny' || value === 'ask';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/rule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/rule.ts packages/core/tests/security/rules/rule.test.ts
git commit -m "feat(core): add rule schema and types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Glob/wildcard matcher

**Files:**
- Create: `packages/core/src/security/rules/matcher.ts`
- Test: `packages/core/tests/security/rules/matcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/security/rules/matcher.test.ts
import { describe, it, expect } from 'vitest';
import { matchPattern } from '../../../src/security/rules/matcher.js';

describe('matchPattern', () => {
  it('matches literal strings', () => {
    expect(matchPattern('git status', 'git status')).toBe(true);
    expect(matchPattern('git status', 'git log')).toBe(false);
  });

  it('matches single wildcard segment', () => {
    expect(matchPattern('git status', 'git *')).toBe(true);
    expect(matchPattern('git status --short', 'git *')).toBe(true);
    expect(matchPattern('rm -rf /', 'git *')).toBe(false);
  });

  it('matches double wildcard paths', () => {
    expect(matchPattern('src/foo/bar.ts', 'src/**/*.ts')).toBe(true);
    expect(matchPattern('src/foo.ts', 'src/**/*.ts')).toBe(true);
    expect(matchPattern('test/foo.ts', 'src/**/*.ts')).toBe(false);
  });

  it('matches single character wildcard', () => {
    expect(matchPattern('foo.ts', 'f?o.ts')).toBe(true);
    expect(matchPattern('fao.ts', 'f?o.ts')).toBe(true);
    expect(matchPattern('foo.ts', 'f??o.ts')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/matcher.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/security/rules/matcher.ts

/**
 * Convert a glob-like pattern to a RegExp.
 * Supported: * (any chars except /), ? (single char), ** (any chars including /)
 */
export function patternToRegExp(pattern: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      regex += '.*';
      i += 2;
    } else if (c === '*') {
      regex += '[^/]*';
      i++;
    } else if (c === '?') {
      regex += '[^/]';
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      regex += '\\' + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  return new RegExp(`^${regex}$`);
}

export function matchPattern(value: string, pattern: string): boolean {
  return patternToRegExp(pattern).test(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/matcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/matcher.ts packages/core/tests/security/rules/matcher.test.ts
git commit -m "feat(core): add glob matcher for rule patterns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: RuleSet merge and priority

**Files:**
- Create: `packages/core/src/security/rules/ruleset.ts`
- Test: `packages/core/tests/security/rules/ruleset.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/security/rules/ruleset.test.ts
import { describe, it, expect } from 'vitest';
import { buildRuleSet } from '../../../src/security/rules/ruleset.js';
import type { Rule } from '../../../src/security/rules/rule.js';

describe('buildRuleSet', () => {
  it('orders rules by source priority', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: '*', action: 'ask', source: 'default' },
      { permission: 'exec', pattern: 'git *', action: 'allow', source: 'profile' },
      { permission: 'exec', pattern: 'git status', action: 'deny', source: 'user-config' },
    ];
    const set = buildRuleSet(rules);
    expect(set[0].source).toBe('user-config');
    expect(set[1].source).toBe('profile');
    expect(set[2].source).toBe('default');
  });

  it('uses findLast semantics', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: '*', action: 'ask', source: 'default' },
      { permission: 'exec', pattern: 'git *', action: 'allow', source: 'profile' },
    ];
    const set = buildRuleSet(rules);
    const matched = set.findLast((r) => r.permission === 'exec' && matchPattern('git status', r.pattern));
    expect(matched?.action).toBe('allow');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/ruleset.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/security/rules/ruleset.ts
import type { Rule, RuleSource } from './rule.js';

const SOURCE_PRIORITY: Record<RuleSource, number> = {
  session: 0,
  'user-config': 1,
  approved: 2,
  profile: 3,
  default: 4,
};

export function buildRuleSet(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source ?? 'default'];
    const pb = SOURCE_PRIORITY[b.source ?? 'default'];
    return pa - pb;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/ruleset.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/ruleset.ts packages/core/tests/security/rules/ruleset.test.ts
git commit -m "feat(core): add ruleset merge and source priority

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Evaluator

**Files:**
- Create: `packages/core/src/security/rules/evaluator.ts`
- Test: `packages/core/tests/security/rules/evaluator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/security/rules/evaluator.test.ts
import { describe, it, expect } from 'vitest';
import { evaluate, type ToolCallPattern } from '../../../src/security/rules/evaluator.js';
import type { Rule } from '../../../src/security/rules/rule.js';

describe('evaluate', () => {
  const call: ToolCallPattern = {
    toolName: 'exec',
    input: { command: 'git status' },
    derivedPatterns: ['bash:git status', 'bash:git *'],
  };

  it('returns allow when rule matches', () => {
    const rules: Rule[] = [{ permission: 'exec', pattern: 'git *', action: 'allow', source: 'profile' }];
    expect(evaluate(call, rules)).toBe('allow');
  });

  it('returns deny when deny rule matches', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: '*', action: 'allow', source: 'profile' },
      { permission: 'exec', pattern: 'rm *', action: 'deny', source: 'user-config' },
    ];
    const rmCall: ToolCallPattern = {
      toolName: 'exec',
      input: { command: 'rm -rf /' },
      derivedPatterns: ['bash:rm -rf /', 'bash:rm *'],
    };
    expect(evaluate(rmCall, rules)).toBe('deny');
  });

  it('defaults to ask when no rule matches', () => {
    expect(evaluate(call, [])).toBe('ask');
  });

  it('uses last matching rule', () => {
    const rules: Rule[] = [
      { permission: 'exec', pattern: 'git *', action: 'deny', source: 'default' },
      { permission: 'exec', pattern: 'git *', action: 'allow', source: 'profile' },
    ];
    expect(evaluate(call, rules)).toBe('allow');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/evaluator.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/security/rules/evaluator.ts
import type { Rule, RuleAction } from './rule.js';
import { matchPattern } from './matcher.js';

export interface ToolCallPattern {
  toolName: string;
  input: unknown;
  derivedPatterns: string[];
}

export function evaluate(toolCall: ToolCallPattern, rules: Rule[], defaultAction: RuleAction = 'ask'): RuleAction {
  const matched = rules.findLast((rule) => {
    if (!matchPattern(toolCall.toolName, rule.permission)) return false;
    return toolCall.derivedPatterns.some((p) => matchPattern(p, rule.pattern));
  });
  return matched?.action ?? defaultAction;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/evaluator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/evaluator.ts packages/core/tests/security/rules/evaluator.test.ts
git commit -m "feat(core): add rule evaluator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: RuleStore local persistence

**Files:**
- Create: `packages/core/src/security/rules/rule-store.ts`
- Test: `packages/core/tests/security/rules/rule-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/security/rules/rule-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RuleStore } from '../../../src/security/rules/rule-store.js';

describe('RuleStore', () => {
  let tmpDir: string;
  let store: RuleStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rem-rules-'));
    store = new RuleStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads empty rules when file does not exist', async () => {
    const rules = await store.loadAll();
    expect(rules).toEqual([]);
  });

  it('saves and loads approved rules', async () => {
    await store.saveApproved({ permission: 'exec', pattern: 'git *', action: 'allow' });
    const rules = await store.loadBySource('approved');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ permission: 'exec', pattern: 'git *', action: 'allow', source: 'approved' });
  });

  it('returns empty array for corrupt file', async () => {
    await fs.writeFile(path.join(tmpDir, 'permissions.json'), 'not json');
    const rules = await store.loadAll();
    expect(rules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/rule-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/security/rules/rule-store.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Rule, RuleSource } from './rule.js';

export interface StoredPermissions {
  version: number;
  approved?: Rule[];
  user?: Rule[];
  profiles?: Record<string, Rule[]>;
}

export class RuleStore {
  private filePath: string;

  constructor(configDir = path.join(os.homedir(), '.config', 'rem')) {
    this.filePath = path.join(configDir, 'permissions.json');
  }

  async loadAll(): Promise<Rule[]> {
    const stored = await this.loadStored();
    return [
      ...(stored.user ?? []).map((r) => ({ ...r, source: 'user-config' as RuleSource })),
      ...(stored.approved ?? []).map((r) => ({ ...r, source: 'approved' as RuleSource })),
    ];
  }

  async loadBySource(source: RuleSource): Promise<Rule[]> {
    const all = await this.loadAll();
    return all.filter((r) => r.source === source);
  }

  async saveApproved(rule: Omit<Rule, 'source'>): Promise<void> {
    const stored = await this.loadStored();
    stored.approved = stored.approved ?? [];
    if (!stored.approved.some((r) => r.permission === rule.permission && r.pattern === rule.pattern)) {
      stored.approved.push(rule);
    }
    await this.saveStored(stored);
  }

  private async loadStored(): Promise<StoredPermissions> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoredPermissions;
      if (parsed.version !== 1) return { version: 1 };
      return parsed;
    } catch {
      return { version: 1 };
    }
  }

  private async saveStored(stored: StoredPermissions): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(stored, null, 2) + '\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/rule-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/rule-store.ts packages/core/tests/security/rules/rule-store.test.ts
git commit -m "feat(core): add local rule store persistence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Profile registry

**Files:**
- Create: `packages/core/src/security/rules/profiles.ts`
- Test: `packages/core/tests/security/rules/profiles.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/security/rules/profiles.test.ts
import { describe, it, expect } from 'vitest';
import { getProfileRules } from '../../../src/security/rules/profiles.js';

describe('getProfileRules', () => {
  it('coding profile allows safe read tools', () => {
    const rules = getProfileRules('coding');
    expect(rules.some((r) => r.permission === 'read' && r.action === 'allow')).toBe(true);
  });

  it('minimal profile only allows session_status', () => {
    const rules = getProfileRules('minimal');
    expect(rules.every((r) => r.permission === 'session_status')).toBe(true);
  });

  it('returns empty for unknown profile', () => {
    expect(getProfileRules('unknown' as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/profiles.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/security/rules/profiles.ts
import type { Rule, RuleAction } from './rule.js';

export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

function rule(permission: string, pattern: string, action: RuleAction): Rule {
  return { permission, pattern, action, source: 'profile' };
}

const PROFILES: Record<ToolProfileId, Rule[]> = {
  minimal: [
    rule('session_status', '*', 'allow'),
  ],
  coding: [
    rule('read', '*', 'allow'),
    rule('ls', '*', 'allow'),
    rule('exec', 'git *', 'allow'),
    rule('exec', 'ls *', 'allow'),
    rule('exec', 'cat *', 'allow'),
    rule('exec', 'grep *', 'allow'),
    rule('exec', 'find *', 'allow'),
    rule('exec', 'pwd', 'allow'),
    rule('exec', 'echo *', 'allow'),
    // write/edit default ask via default rules
  ],
  messaging: [
    rule('session_status', '*', 'allow'),
  ],
  full: [],
};

export function getProfileRules(profile: ToolProfileId): Rule[] {
  return PROFILES[profile] ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/profiles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/profiles.ts packages/core/tests/security/rules/profiles.test.ts
git commit -m "feat(core): add tool policy profiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Error types

**Files:**
- Create: `packages/core/src/security/rules/errors.ts`
- Test: `packages/core/tests/security/rules/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/security/rules/errors.test.ts
import { describe, it, expect } from 'vitest';
import { ToolDeniedError } from '../../../src/security/rules/errors.js';

describe('ToolDeniedError', () => {
  it('encapsulates denial reason', () => {
    const err = new ToolDeniedError('exec', 'rule');
    expect(err.toolName).toBe('exec');
    expect(err.reason).toBe('rule');
    expect(err.message).toContain('denied');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/errors.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/security/rules/errors.ts

export type DenialReason = 'rule' | 'user' | 'workspace' | 'parse';

export class ToolDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly reason: DenialReason,
    message?: string,
  ) {
    super(message ?? `Tool "${toolName}" denied: ${reason}`);
    this.name = 'ToolDeniedError';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/rules/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/rules/errors.ts packages/core/tests/security/rules/errors.test.ts
git commit -m "feat(core): add ToolDeniedError type

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Exec command classifier (AST first layer)

**Files:**
- Create: `packages/core/src/security/exec-classifier.ts`
- Modify: `packages/core/package.json` (add `bash-parser` dependency)
- Test: `packages/core/tests/security/exec-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/security/exec-classifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyCommand, SAFE_BINS } from '../../../src/security/exec-classifier.js';

describe('classifyCommand', () => {
  it('classifies safe bins as safe', () => {
    const c = classifyCommand('ls -la');
    expect(c.risk).toBe('safe');
    expect(c.baseCommand).toBe('ls');
  });

  it('classifies git status as safe', () => {
    const c = classifyCommand('git status');
    expect(c.risk).toBe('safe');
    expect(c.baseCommand).toBe('git');
  });

  it('classifies rm as dangerous', () => {
    const c = classifyCommand('rm -rf node_modules');
    expect(c.risk).toBe('dangerous');
  });

  it('classifies pipes as complex', () => {
    const c = classifyCommand('cat file | grep x');
    expect(c.risk).toBe('complex');
  });

  it('classifies bash -c as complex', () => {
    const c = classifyCommand('bash -c "rm -rf /"');
    expect(c.risk).toBe('complex');
  });

  it('generates always options for safe command', () => {
    const c = classifyCommand('git status');
    expect(c.patterns).toContain('bash:git status');
    expect(c.patterns).toContain('bash:git *');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/exec-classifier.test.ts`
Expected: FAIL

- [ ] **Step 3: Install bash-parser**

Run:
```bash
cd /Users/guoshencheng/Documents/work/rem/packages/core
pnpm add bash-parser
```

- [ ] **Step 4: Write minimal implementation**

```typescript
// packages/core/src/security/exec-classifier.ts
import { parse } from 'bash-parser';

export const SAFE_BINS = new Set([
  'ls', 'cat', 'grep', 'find', 'pwd', 'echo', 'head', 'tail',
  'git', // git subcommands filtered below
]);

export const SAFE_GIT_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'branch', 'show', 'remote', 'config',
]);

export const DANGEROUS_BINS = new Set([
  'rm', 'sudo', 'curl', 'wget', 'sh', 'bash', 'eval',
]);

export type CommandRisk = 'safe' | 'normal' | 'dangerous' | 'complex';

export interface CommandClassification {
  risk: CommandRisk;
  baseCommand: string;
  subCommand?: string;
  patterns: string[];
}

export function classifyCommand(command: string): CommandClassification {
  try {
    const ast = parse(command);
    if (!isSimpleCommand(ast)) {
      return { risk: 'complex', baseCommand: '', patterns: ['bash:*'] };
    }
    const { name, args } = extractSimpleCommand(ast);
    const subCommand = name === 'git' ? args[0] : undefined;
    const risk = computeRisk(name, subCommand);
    return {
      risk,
      baseCommand: name,
      subCommand,
      patterns: buildPatterns(name, subCommand, command, risk),
    };
  } catch {
    return { risk: 'complex', baseCommand: '', patterns: ['bash:*'] };
  }
}

function isSimpleCommand(ast: unknown): boolean {
  // Implement based on bash-parser AST shape.
  // Return true only if AST is a single Command node with no pipes/chains/subshells.
  const node = ast as any;
  if (node?.type !== 'Script') return false;
  if (node.commands?.length !== 1) return false;
  const cmd = node.commands[0];
  return cmd.type === 'Command';
}

function extractSimpleCommand(ast: unknown): { name: string; args: string[] } {
  const cmd = (ast as any).commands[0];
  const name = cmd.name?.text ?? '';
  const args = (cmd.suffix ?? [])
    .filter((s: any) => s.type === 'Word')
    .map((s: any) => s.text);
  return { name, args };
}

function computeRisk(baseCommand: string, subCommand?: string): CommandRisk {
  if (DANGEROUS_BINS.has(baseCommand)) return 'dangerous';
  if (baseCommand === 'git' && subCommand && !SAFE_GIT_SUBCOMMANDS.has(subCommand)) {
    return 'normal';
  }
  if (SAFE_BINS.has(baseCommand)) return 'safe';
  return 'normal';
}

function buildPatterns(name: string, subCommand: string | undefined, command: string, risk: CommandRisk): string[] {
  const exact = `bash:${command}`;
  const byBase = `bash:${name}${subCommand ? ` ${subCommand}` : ''} *`;
  const byName = `bash:${name} *`;

  if (risk === 'complex') return [];
  if (risk === 'dangerous') return [exact, byName];
  if (risk === 'safe') return [exact, byBase, byName, 'bash:safe-bins:*'];
  return [exact, byBase, byName];
}
```

Note: The exact AST shape from `bash-parser` may differ. Adjust `isSimpleCommand` and `extractSimpleCommand` after inspecting real AST output.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/security/exec-classifier.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/security/exec-classifier.ts packages/core/tests/security/exec-classifier.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add exec command risk classifier

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: ApprovalEngine

**Files:**
- Create: `packages/core/src/execute/approval-engine.ts`
- Test: `packages/core/tests/execute/approval-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/execute/approval-engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalEngine } from '../../../src/execute/approval-engine.js';
import type { Rule } from '../../../src/security/rules/rule.js';

describe('ApprovalEngine', () => {
  let engine: ApprovalEngine;

  beforeEach(() => {
    engine = new ApprovalEngine('session-1');
  });

  it('creates a request', () => {
    const req = engine.createRequest({
      toolCallId: 'tc-1',
      toolName: 'write',
      patterns: ['file:src/foo.ts'],
      alwaysOptions: [
        { label: 'src/foo.ts', rule: { permission: 'write', pattern: 'src/foo.ts', action: 'allow', source: 'approved' } },
      ],
    });
    expect(req.approvalId).toBeDefined();
    expect(req.toolName).toBe('write');
  });

  it('resolves once without persisting rule', async () => {
    const req = engine.createRequest({ toolCallId: 'tc-1', toolName: 'write', patterns: ['file:src/foo.ts'], alwaysOptions: [] });
    const promise = engine.wait(req.approvalId);
    engine.resolve(req.approvalId, 'once');
    const res = await promise;
    expect(res.decision).toBe('once');
    expect(res.rule).toBeUndefined();
  });

  it('resolves always with a rule', async () => {
    const rule: Omit<Rule, 'source'> = { permission: 'write', pattern: '*.ts', action: 'allow' };
    const req = engine.createRequest({ toolCallId: 'tc-1', toolName: 'write', patterns: ['file:src/foo.ts'], alwaysOptions: [{ label: '*.ts', rule }] });
    const promise = engine.wait(req.approvalId);
    engine.resolve(req.approvalId, 'always', rule);
    const res = await promise;
    expect(res.decision).toBe('always');
    expect(res.rule).toEqual(rule);
  });

  it('does not timeout', async () => {
    const req = engine.createRequest({ toolCallId: 'tc-1', toolName: 'write', patterns: [], alwaysOptions: [] });
    const promise = engine.wait(req.approvalId);
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.isPending(req.approvalId)).toBe(true);
    engine.resolve(req.approvalId, 'deny');
    await expect(promise).resolves.toBe('deny');
  });

  it('denies all pending', async () => {
    const req1 = engine.createRequest({ toolCallId: 'tc-1', toolName: 'write', patterns: [], alwaysOptions: [] });
    const req2 = engine.createRequest({ toolCallId: 'tc-2', toolName: 'write', patterns: [], alwaysOptions: [] });
    const p1 = engine.wait(req1.approvalId);
    const p2 = engine.wait(req2.approvalId);
    engine.denyAll();
    await expect(p1).resolves.toBe('deny');
    await expect(p2).resolves.toBe('deny');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter rem-agent-core test packages/core/tests/execute/approval-engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/execute/approval-engine.ts
import type { Rule } from '../security/rules/rule.js';
import type { ApprovalRequest } from '../sdk/agent-state-provider.js';
import { generateId } from '../shared/generate-id.js';

export type ApprovalDecision = 'once' | 'always' | 'deny';

export interface CreateApprovalInput {
  toolCallId: string;
  toolName: string;
  patterns: string[];
  title?: string;
  description?: string;
  severity?: ApprovalRequest['severity'];
  alwaysOptions: Array<{ label: string; rule: Omit<Rule, 'source'> }>;
}

export interface ApprovalResolution {
  decision: ApprovalDecision;
  rule?: Omit<Rule, 'source'>;
}

export class ApprovalEngine {
  private pending = new Map<string, {
    request: ApprovalRequest;
    resolve: (value: ApprovalResolution) => void;
  }>();

  createRequest(input: CreateApprovalInput): ApprovalRequest {
    const approvalId = generateId();
    const request: ApprovalRequest = {
      approvalId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      patterns: input.patterns,
      title: input.title ?? `Run ${input.toolName}`,
      description: input.description,
      severity: input.severity ?? 'warning',
      allowedDecisions: this.buildAllowedDecisions(input.alwaysOptions),
      alwaysOptions: input.alwaysOptions,
    };

    // Placeholder resolver; replaced by wait()
    this.pending.set(approvalId, { request, resolve: () => {} });
    return request;
  }

  wait(approvalId: string): Promise<ApprovalResolution> {
    const entry = this.pending.get(approvalId);
    if (!entry) return Promise.resolve({ decision: 'deny' });
    return new Promise<ApprovalResolution>((resolve) => {
      entry.resolve = (res) => {
        this.pending.delete(approvalId);
        resolve(res);
      };
    });
  }

  resolve(approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    entry.resolve({ decision, rule });
    return true;
  }

  denyAll(): void {
    for (const [id, entry] of this.pending) {
      entry.resolve({ decision: 'deny' });
      this.pending.delete(id);
    }
  }

  isPending(approvalId: string): boolean {
    return this.pending.has(approvalId);
  }

  private buildAllowedDecisions(options: Array<{ label: string; rule: Omit<Rule, 'source'> }>): Array<'allow-once' | 'allow-always' | 'deny'> {
    const decisions: Array<'allow-once' | 'allow-always' | 'deny'> = ['allow-once', 'deny'];
    if (options.length > 0) decisions.push('allow-always');
    return decisions;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter rem-agent-core test packages/core/tests/execute/approval-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/execute/approval-engine.ts packages/core/tests/execute/approval-engine.test.ts
git commit -m "feat(core): add approval engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Tool provider pattern derivation hooks

**Files:**
- Modify: `packages/core/src/sdk/tool-provider.ts`
- Modify: `packages/core/src/plugins/tool/file-system/index.ts`
- Modify: `packages/core/src/plugins/tool/file-system/exec.ts` (read command input shape)
- Test: `packages/core/tests/tool-pattern-derivation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/tool-pattern-derivation.test.ts
import { describe, it, expect } from 'vitest';
import { createFileSystemTools } from '../src/plugins/tool/file-system/index.js';
import type { ConfigProvider } from '../src/sdk/config-provider.js';

describe('tool pattern derivation', () => {
  const mockConfig: ConfigProvider = {
    getConfig: () => ({} as any),
    getModelConfig: () => ({} as any),
    getToolConfig: () => ({}),
    getBehaviorConfig: () => ({ workspaceRoot: '/tmp', name: 'test', maxTurns: 10, readOnly: false }),
    getMcpConfig: () => ({}),
  };

  it('exec derives bash patterns', () => {
    const registry = createFileSystemTools(mockConfig, { enqueue: async () => {} } as any);
    const tool = registry.getToolSet().exec;
    expect(tool).toBeDefined();
    // derivePatterns is attached to the ToolDefinition; registry does not expose it directly.
    // Instead test through executeTools integration in Task 13.
  });
});
```

This task is mostly plumbing; rely on integration tests in Task 13 for behavior verification.

- [ ] **Step 2: Update ToolDefinition and ToolProvider interfaces**

```typescript
// packages/core/src/sdk/tool-provider.ts
export interface ToolDefinition<T extends TObject = TObject> {
  name: string;
  description: string;
  parameters: T;
  category?: 'filesystem' | 'shell' | 'search' | 'mcp';
  dangerous?: boolean;
  readOnly?: boolean;
  /** Derive rule patterns from a tool call input. */
  derivePatterns?: (input: Static<T>) => string[];
  /** Generate always-options for the approval UI. */
  deriveAlwaysOptions?: (input: Static<T>) => Array<{ label: string; rule: Omit<Rule, 'source'> }>;
}
```

Add `Rule` import at top:
```typescript
import type { Rule } from '../security/rules/rule.js';
```

- [ ] **Step 3: Add pattern derivations to fs tools**

Modify `packages/core/src/plugins/tool/file-system/exec.ts` to export a `deriveExecPatterns` helper, then wire it in `index.ts`.

In `index.ts`:
```typescript
import { classifyCommand } from '../../../security/exec-classifier.js';

const execDef = createExecToolDefinition();
registry.register(
  {
    ...execDef,
    derivePatterns: (input) => {
      const c = classifyCommand(input.command);
      return c.patterns;
    },
    deriveAlwaysOptions: (input) => {
      const c = classifyCommand(input.command);
      return c.patterns.map((pattern) => ({
        label: pattern,
        rule: { permission: 'exec', pattern, action: 'allow' },
      }));
    },
  },
  createExecToolExecutor(),
);
```

For write/edit/ls/read tools, add simple path-based derivations:
```typescript
function deriveFilePatterns(input: { filePath?: string; path?: string }): string[] {
  const p = input.filePath ?? input.path ?? '';
  return [`file:${p}`];
}

function deriveFileAlwaysOptions(input: { filePath?: string; path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.filePath ?? input.path ?? '';
  const parts = p.split('/').filter(Boolean);
  const options: Array<{ label: string; rule: Omit<Rule, 'source'> }> = [];
  options.push({ label: p, rule: { permission: 'write', pattern: p, action: 'allow' } });
  if (parts.length >= 2) {
    const dir = parts.slice(0, -1).join('/') + '/*';
    options.push({ label: dir, rule: { permission: 'write', pattern: dir, action: 'allow' } });
  }
  if (p.includes('.')) {
    const ext = '*.' + p.split('.').pop();
    options.push({ label: ext, rule: { permission: 'write', pattern: ext, action: 'allow' } });
  }
  options.push({ label: 'all', rule: { permission: 'write', pattern: '*', action: 'allow' } });
  return options;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sdk/tool-provider.ts packages/core/src/plugins/tool/file-system/index.ts packages/core/tests/tool-pattern-derivation.test.ts
git commit -m "feat(core): add tool pattern derivation hooks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: AgentState / ApprovalEngine integration

**Files:**
- Modify: `packages/core/src/execute/approval-registry.ts` (delete timeout)
- Modify: `packages/core/src/execute/approval-engine.ts` (reuse from Task 9)
- Modify: `packages/core/src/state.ts`
- Modify: `packages/core/src/agent-state.ts`
- Modify: `packages/core/src/sdk/agent-state-provider.ts`
- Test: `packages/core/tests/approval-engine-integration.test.ts`

- [ ] **Step 1: Update ApprovalRequest type**

```typescript
// packages/core/src/sdk/agent-state-provider.ts
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export interface ApprovalRequest {
  approvalId: string;
  toolName: string;
  toolCallId?: string;
  title: string;
  description?: string;
  severity?: 'info' | 'warning' | 'critical';
  allowedDecisions: ApprovalDecision[];
  sessionId?: string;
  patterns: string[];
  alwaysOptions: Array<{ label: string; rule: Omit<Rule, 'source'> }>;
}
```

- [ ] **Step 2: Replace ApprovalRegistry with ApprovalEngine on AgentLiveState**

```typescript
// packages/core/src/state.ts
import { ApprovalEngine } from './execute/approval-engine.js';

export class AgentLiveState {
  // ... existing fields ...

  /** 当前会话的审批引擎（管理审批 Promise，无超时） */
  readonly approvalEngine = new ApprovalEngine();
}
```

Remove the old `approvalRegistry` import and field.

- [ ] **Step 3: Simplify or remove ApprovalRegistry**

`packages/core/src/execute/approval-registry.ts` can be deleted since `ApprovalEngine` from Task 9 now handles pending approvals. Update any remaining imports.

- [ ] **Step 4: Update AgentState to use approvalEngine**

```typescript
// packages/core/src/agent-state.ts
import type { ApprovalResolution } from './execute/approval-engine.js';
import type { Rule } from './security/rules/rule.js';

waitApproval(sessionId: string, approvalId: string): Promise<ApprovalResolution> {
  return this.getOrCreate(sessionId).approvalEngine.wait(approvalId);
}

resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): boolean {
  return this.getOrCreate(sessionId).approvalEngine.resolve(approvalId, decision, rule);
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter rem-agent-core test packages/core/tests/approval-engine-integration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/execute/approval-engine.ts packages/core/src/execute/approval-registry.ts packages/core/src/state.ts packages/core/src/agent-state.ts packages/core/src/sdk/agent-state-provider.ts
git commit -m "refactor(core): replace ApprovalRegistry with ApprovalEngine, remove timeout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Refactor execute-tools.ts to use rule engine

**Files:**
- Modify: `packages/core/src/execute/execute-tools.ts`
- Test: `packages/core/tests/execute/execute-tools-rules.test.ts`

- [ ] **Step 1: Add RuleEngine facade**

Create `packages/core/src/security/rules/rule-engine.ts`:

```typescript
// packages/core/src/security/rules/rule-engine.ts
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

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }
}
```

- [ ] **Step 2: Update ExecuteParams**

```typescript
// packages/core/src/execute/execute-tools.ts
export interface ExecuteParams {
  toolCalls: ToolCall[];
  toolProvider: ToolProvider;
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

- [ ] **Step 3: Replace dangerous check with rule evaluation**

```typescript
// packages/core/src/execute/execute-tools.ts core loop
for (const tc of params.toolCalls) {
  log('tools', 'executing tool call', { sessionId: params.sessionId, toolCallId: tc.toolCallId, toolName: tc.toolName });

  const derivedPatterns = derivePatterns(tc, params.toolProvider);
  const action = params.ruleEngine.evaluate({ toolName: tc.toolName, input: tc.input, derivedPatterns });

  if (action === 'deny') {
    const denied: ToolResult = { toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: 'denied by rule' };
    emitToolResult(tc, denied, emit, addMessage, appendContent);
    results.push(denied);
    continue;
  }

  if (action === 'ask') {
    const alwaysOptions = deriveAlwaysOptions(tc, params.toolProvider);
    const liveState = agentState.getOrCreate(params.sessionId);
    const request = liveState.approvalEngine.createRequest({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      patterns: derivedPatterns,
      title: `Run ${tc.toolName}`,
      description: formatDescription(tc),
      severity: 'warning',
      alwaysOptions,
    });

    liveState.pendingApprovals.push(request);
    emit({ type: 'approval-request', sessionId: params.sessionId, request } as ProviderChunk);

    const resolution = await liveState.approvalEngine.wait(request.approvalId);

    liveState.pendingApprovals = liveState.pendingApprovals.filter((r) => r.approvalId !== request.approvalId);
    emit({ type: 'approval-resolved', sessionId: params.sessionId, approvalId: request.approvalId, decision: resolution.decision } as ProviderChunk);

    if (resolution.decision === 'deny') {
      const denied: ToolResult = { toolCallId: tc.toolCallId, toolName: tc.toolName, output: '', error: 'denied' };
      emitToolResult(tc, denied, emit, addMessage, appendContent);
      results.push(denied);
      continue;
    }

    if (resolution.decision === 'always' && resolution.rule) {
      await params.ruleStore.saveApproved(resolution.rule);
      params.ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
    }
  }

  // execute
  const [result] = await toolProvider.execute([tc], { ... });
  results.push(result);
  emitToolResult(tc, result, emit, addMessage, appendContent);
}
```

Helper functions:
```typescript
function derivePatterns(tc: ToolCall, toolProvider: ToolProvider): string[] {
  const def = toolProvider.getToolDefinition(tc.toolName);
  if (def?.derivePatterns) {
    return def.derivePatterns(tc.input);
  }
  return [`tool:${tc.toolName}`];
}

function deriveAlwaysOptions(tc: ToolCall, toolProvider: ToolProvider): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const def = toolProvider.getToolDefinition(tc.toolName);
  if (def?.deriveAlwaysOptions) {
    return def.deriveAlwaysOptions(tc.input);
  }
  return [
    { label: tc.toolName, rule: { permission: tc.toolName, pattern: '*', action: 'allow' } },
  ];
}
```

- [ ] **Step 4: Update AgentToolRegistry to expose definition lookup**

```typescript
// packages/core/src/registry/tool-registry.ts
getToolDefinition(name: string): ToolDefinition | undefined {
  return this.tools.get(name)?.def;
}
```

Update `ToolProvider` interface in `tool-provider.ts` to include `getToolDefinition(name: string): ToolDefinition | undefined`.

- [ ] **Step 5: Run integration tests**

Run: `pnpm --filter rem-agent-core test packages/core/tests/execute/execute-tools-rules.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/security/rules/rule-engine.ts packages/core/src/execute/execute-tools.ts packages/core/src/registry/tool-registry.ts packages/core/src/sdk/tool-provider.ts packages/core/tests/execute/execute-tools-rules.test.ts
git commit -m "feat(core): wire rule engine into execute-tools

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Wire RuleEngine/RuleStore into AgentContext and runAgent

**Files:**
- Modify: `packages/core/src/agent-context.ts`
- Modify: `packages/core/src/sdk/config-provider.ts`
- Modify: `packages/core/src/core-agent.ts`
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: Update AgentContext**

```typescript
// packages/core/src/agent-context.ts
import type { RuleEngine } from './security/rules/rule-engine.js';
import type { RuleStore } from './security/rules/rule-store.js';

export interface AgentContext {
  configProvider: ConfigProvider;
  sessionProvider: SessionProvider;
  toolProvider: ToolProvider;
  mcpProviders: ToolProvider[];
  skillProvider: SkillProvider;
  toolComposer: ToolComposer;
  contextProvider: ContextProvider;
  budgetPolicy: BudgetPolicy;
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;
  loopStrategy: LoopStrategy;
  mcpManager: McpConnectionManager;
  fileMutationQueue: FileMutationQueue;
  systemPromptAssembler: SystemPromptAssembler;
  ruleEngine: RuleEngine;
  ruleStore: RuleStore;
}
```

- [ ] **Step 2: Update ConfigProvider**

```typescript
// packages/core/src/sdk/config-provider.ts
export interface AgentBehaviorConfig {
  name?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  sessionsDir?: string;
  profile?: ToolProfileId;
}

export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  // ... existing fields ...
  sessionRules?: Rule[];
}
```

- [ ] **Step 3: Build RuleEngine in core-agent.ts**

In `packages/core/src/core-agent.ts` (where `buildAgentContext` is defined), add:

```typescript
import { RuleEngine } from './security/rules/rule-engine.js';
import { RuleStore } from './security/rules/rule-store.js';
import { getProfileRules } from './security/rules/profiles.js';

async function buildRuleEngine(config: ResolvedAgentConfig): Promise<RuleEngine> {
  const store = new RuleStore();
  const userRules = await store.loadAll();
  const profileRules = getProfileRules(config.profile ?? 'coding');
  const defaultRules: Rule[] = buildDefaultRules();
  const sessionRules = config.sessionRules ?? [];
  return new RuleEngine([...defaultRules, ...profileRules, ...userRules, ...sessionRules]);
}

function buildDefaultRules(): Rule[] {
  return [
    { permission: 'read', pattern: '*', action: 'allow', source: 'default' },
    { permission: 'ls', pattern: '*', action: 'allow', source: 'default' },
    { permission: 'session_status', pattern: '*', action: 'allow', source: 'default' },
    // Everything else defaults to ask via the evaluator default.
  ];
}
```

Pass `ruleEngine` and `ruleStore` into `AgentContext`.

- [ ] **Step 4: Pass into executeTools**

In `packages/core/src/run-agent.ts`:

```typescript
execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
  toolCalls: calls,
  toolProvider: effectiveToolProvider,
  addMessage,
  appendContent,
  agentState: params.agentState,
  ruleEngine: ctx.ruleEngine,
  ruleStore: ctx.ruleStore,
  workspaceRoot,
  agentName: behavior.name,
  readOnly: behavior.readOnly,
  sessionId: params.sessionId,
  signal: params.signal,
  emit: (chunk) => trackMessageStart(chunk),
}),
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (may require fixing imports)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent-context.ts packages/core/src/sdk/config-provider.ts packages/core/src/core-agent.ts packages/core/src/run-agent.ts
git commit -m "feat(core): wire rule engine and store into agent context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Bridge resolveApproval update

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Modify: `packages/bridge/src/agent-service.interface.ts`

- [ ] **Step 1: Update IAgentService**

```typescript
// packages/bridge/src/agent-service.interface.ts
import type { ApprovalDecision, ApprovalRequest, Rule } from 'rem-agent-core';

export interface IAgentService {
  // ... existing methods ...
  listPendingApprovals(workspace: string, sessionId: string): Promise<ApprovalRequest[]>;
  resolveApproval(
    workspace: string,
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
    rule?: Omit<Rule, 'source'>,
  ): Promise<boolean>;
}
```

- [ ] **Step 2: Update AgentService.resolveApproval**

```typescript
// packages/bridge/src/agent.ts
async resolveApproval(
  _workspace: string,
  sessionId: string,
  approvalId: string,
  decision: ApprovalDecision,
  rule?: Omit<Rule, 'source'>,
): Promise<boolean> {
  // Persist the approved rule before resolving so the engine sees it immediately.
  if (decision === 'allow-always' && rule) {
    await this.ctx!.ruleStore.saveApproved(rule);
  }
  return this.agentState.resolveApproval(sessionId, approvalId, decision, rule);
}
```

Ensure `Rule` is imported from `rem-agent-core` and `RuleStore` is available on `AgentContext`.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/agent.ts packages/bridge/src/agent-service.interface.ts
git commit -m "feat(bridge): accept rule in resolveApproval

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Web approval UI always-options dropdown

**Files:**
- Modify: `packages/web/src/components/chat/approval-bar.tsx`
- Modify: `packages/web/src/app/api/approvals/[id]/resolve/route.ts`
- Modify: `packages/web/src/lib/use-agents.ts` (onResolveApproval)
- Test: `packages/web/tests/approval-bar.test.tsx`

- [ ] **Step 1: Update ApprovalBar props**

```typescript
// packages/web/src/components/chat/approval-bar.tsx
interface ApprovalBarProps {
  approvals: ApprovalRequest[];
  onResolve(approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): void;
}
```

- [ ] **Step 2: Render always options**

```tsx
export function ApprovalBar({ approvals, onResolve }: ApprovalBarProps) {
  const [selectedRule, setSelectedRule] = useState<Record<string, Omit<Rule, 'source'> | undefined>>({});

  if (approvals.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mb-3">
      {approvals.map((request) => (
        <div key={request.approvalId} className={cn('rounded-xl border p-3 text-sm', severityClass(request.severity))}>
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5">{severityIcon(request.severity)}</div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{request.title}</div>
              {request.description ? (
                <div className="mt-1 text-xs opacity-80 leading-relaxed">{request.description}</div>
              ) : null}

              {request.alwaysOptions.length > 0 && (
                <div className="mt-2">
                  <label className="text-xs opacity-70">Always allow scope:</label>
                  <select
                    className="mt-1 block w-full text-xs rounded border bg-bg px-2 py-1"
                    value={selectedRule[request.approvalId]?.pattern ?? ''}
                    onChange={(e) => {
                      const option = request.alwaysOptions.find((o) => o.rule.pattern === e.target.value);
                      setSelectedRule((prev) => ({ ...prev, [request.approvalId]: option?.rule }));
                    }}
                  >
                    {request.alwaysOptions.map((option) => (
                      <option key={option.rule.pattern} value={option.rule.pattern}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2">
                {request.allowedDecisions.includes('allow-once') && (
                  <button onClick={() => onResolve(request.approvalId, 'allow-once')} ...>Allow once</button>
                )}
                {request.allowedDecisions.includes('allow-always') && (
                  <button onClick={() => onResolve(request.approvalId, 'allow-always', selectedRule[request.approvalId])} ...>Always allow</button>
                )}
                {request.allowedDecisions.includes('deny') && (
                  <button onClick={() => onResolve(request.approvalId, 'deny')} ...>Deny</button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Update resolve route to forward rule**

```typescript
// packages/web/src/app/api/approvals/[id]/resolve/route.ts
const { sessionId, decision, rule } = body as { sessionId?: string; decision?: ApprovalDecision; rule?: Omit<Rule, 'source'> };

const result = await agentService.resolveApproval(workspace, sessionId, id, decision, rule);
```

- [ ] **Step 4: Update use-agents onResolveApproval**

```typescript
// packages/web/src/lib/use-agents.ts
async function resolveApproval(approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>) {
  const state = getSessionState(currentSessionId);
  if (!state) return;
  await fetch(`/api/approvals/${encodeURIComponent(approvalId)}/resolve?workspace=${encodeURIComponent(state.workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: currentSessionId, decision, rule }),
  });
}
```

- [ ] **Step 5: Add basic component test**

```typescript
// packages/web/tests/approval-bar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalBar } from '../src/components/chat/approval-bar';

describe('ApprovalBar', () => {
  it('renders always options and resolves with rule', () => {
    const onResolve = vi.fn();
    render(
      <ApprovalBar
        approvals={[
          {
            approvalId: 'a1',
            toolName: 'write',
            title: 'Write file',
            allowedDecisions: ['allow-once', 'allow-always', 'deny'],
            patterns: [],
            alwaysOptions: [
              { label: 'src/foo.ts', rule: { permission: 'write', pattern: 'src/foo.ts', action: 'allow' } },
              { label: '*.ts', rule: { permission: 'write', pattern: '*.ts', action: 'allow' } },
            ],
          },
        ]}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByText('Always allow'));
    expect(onResolve).toHaveBeenCalledWith('a1', 'allow-always', { permission: 'write', pattern: 'src/foo.ts', action: 'allow' });
  });
});
```

- [ ] **Step 6: Run web tests**

Run: `pnpm --filter rem-agent-web test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/chat/approval-bar.tsx packages/web/src/app/api/approvals/[id]/resolve/route.ts packages/web/src/lib/use-agents.ts packages/web/tests/approval-bar.test.tsx
git commit -m "feat(web): approval UI with always scope selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Integration tests and final verification

**Files:**
- Create: `packages/core/tests/execute/execute-tools-rules.test.ts`
- Create: `packages/core/tests/security/workspace-guard.test.ts` (if not exists)
- Create: `packages/core/tests/security/exec-injection.test.ts`
- Create: `packages/core/tests/security/exec-dangerous.test.ts`

- [ ] **Step 1: Write execute-tools integration test**

```typescript
// packages/core/tests/execute/execute-tools-rules.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { executeTools } from '../../src/execute/execute-tools.js';
import { AgentToolRegistry } from '../../src/registry/tool-registry.js';
import { AgentState } from '../../src/agent-state.js';
import { RuleEngine } from '../../src/security/rules/rule-engine.js';
import { RuleStore } from '../../src/security/rules/rule-store.js';
import type { ToolDefinition, ToolExecutor } from '../../src/sdk/tool-provider.js';
import { Type } from '@sinclair/typebox';

describe('executeTools with rules', () => {
  let registry: AgentToolRegistry;
  let agentState: AgentState;
  let ruleStore: RuleStore;
  let chunks: unknown[] = [];

  beforeEach(async () => {
    registry = new AgentToolRegistry({ workspaceRoot: '/tmp' });
    const echoDef: ToolDefinition = {
      name: 'echo',
      description: 'echo',
      parameters: Type.Object({ text: Type.String() }),
      derivePatterns: (input) => [`echo:${input.text}`],
    };
    const echoExec: ToolExecutor = async (input) => ({ output: input.text });
    registry.register(echoDef, echoExec);

    agentState = new AgentState();
    ruleStore = new RuleStore();
    chunks = [];
  });

  it('allows when rule matches allow', async () => {
    const engine = new RuleEngine([{ permission: 'echo', pattern: 'hello*', action: 'allow', source: 'user-config' }]);
    const results = await executeTools({
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: { text: 'hello-world' } }],
      toolProvider: registry,
      agentState,
      ruleEngine: engine,
      ruleStore,
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c) => chunks.push(c),
    });
    expect(results[0].output).toBe('hello-world');
  });

  it('denies when rule matches deny', async () => {
    const engine = new RuleEngine([{ permission: 'echo', pattern: 'secret*', action: 'deny', source: 'user-config' }]);
    const results = await executeTools({
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: { text: 'secret-key' } }],
      toolProvider: registry,
      agentState,
      ruleEngine: engine,
      ruleStore,
      workspaceRoot: '/tmp',
      sessionId: 's1',
      addMessage: () => ({ id: 'm1', role: 'tool', content: [] } as any),
      appendContent: () => {},
      emit: (c) => chunks.push(c),
    });
    expect(results[0].error).toBe('denied by rule');
  });
});
```

- [ ] **Step 2: Run full core test suite**

Run: `pnpm --filter rem-agent-core test`
Expected: PASS

- [ ] **Step 3: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/tests/execute/execute-tools-rules.test.ts
git commit -m "test(core): add execute-tools rule integration tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Checklist

After completing all tasks, run through this checklist:

- [ ] **Spec coverage:** Every section of `2026-07-09-tool-call-security-design.md` has a corresponding task.
- [ ] **No placeholders:** Search plan for "TBD", "TODO", "implement later", "fill in details" — none should remain.
- [ ] **Type consistency:** `ApprovalDecision`, `Rule`, `ApprovalRequest` types match across all files.
- [ ] **No timeouts:** `ApprovalRegistry.wait` does not accept or use a timeout parameter.
- [ ] **Persistence:** `allow-always` decisions write to `~/.config/rem/permissions.json` via `RuleStore`.
- [ ] **Pattern matching:** `matchPattern` supports `*`, `?`, `**`.
- [ ] **AST fallback:** `classifyCommand` returns `complex` when parser fails.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-09-tool-call-security.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
