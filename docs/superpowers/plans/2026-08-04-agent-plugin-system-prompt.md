# Agent Plugin System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synchronous Agent plugin protocol that composes named system-prompt sections during Core assembly while keeping `runtime` last and injecting the finalized assembler through `AgentDI`.

**Architecture:** `AgentPlugin` contributes through a short-lived `PromptSectionRegistry` transaction. A prompt registry store owns ordered section state and rollback, a plugin host validates and runs plugins in configuration order, and assembly finalizes the resulting section snapshot into `AgentDI.systemPromptAssembler`. Runtime prompt resolution only builds context and consumes that injected assembler.

**Tech Stack:** TypeScript 5.4, Node.js 22, Vitest, pnpm, `@earendil-works/pi-ai`

---

## File structure

Create or modify only the following focused units:

- `packages/core/src/sdk/agent-plugin.ts` — stable plugin protocol and registration context.
- `packages/core/src/sdk/system-prompt.ts` — existing prompt contracts plus the stable registry capability.
- `packages/core/src/plugin-system/errors.ts` — identifiable plugin and prompt-registry assembly errors.
- `packages/core/src/plugin-system/plugin-host.ts` — plugin name validation, ordering, and error wrapping.
- `packages/core/src/system-prompt/section-registry.ts` — ordered section state, transactions, protection rules, diagnostics, and final snapshots.
- `packages/core/src/system-prompt/default-sections.ts` — construct Core-owned default sections without promising their relative order.
- `packages/core/src/system-prompt/assembler.ts` — accept the finalized readonly section snapshot.
- `packages/core/src/system-prompt/default-assembler.ts` — compose defaults, plugins, selector, and immutable assembler.
- `packages/core/src/assembly/agent-di.ts` — expose the finalized runtime assembler.
- `packages/core/src/assembly/types.ts` — carry plugins through low-level assembly options.
- `packages/core/src/assembly/agent-assembly.ts` — accept plugins at the public synchronous factory.
- `packages/core/src/assembly/agent-context-assembler.ts` — create and inject the plugin-aware assembler.
- `packages/core/src/agent/context/resolve-system-prompt.ts` — consume DI instead of constructing defaults.
- `packages/core/src/sdk/index.ts` and `packages/core/src/index.ts` — export stable public contracts and errors.
- `packages/core/tests/prompt-section-registry.test.ts` — registry behavior and transaction tests.
- `packages/core/tests/plugin-host.test.ts` — plugin ordering, identity, rollback, and wrapping tests.
- `packages/core/tests/system-prompt-plugin.test.ts` — assembly-to-runtime integration tests.
- `packages/core/tests/helpers/fake-di.ts` — allow integration tests to pass plugins through the real assembly path.
- `docs/architecture.md` and `docs/module-reference.md` — document the new assembly-time plugin boundary.

Do not modify `archive/`. Do not add dynamic loading, hot swapping, tool/skill hooks, dependency ordering, or numeric priorities.

### Task 1: Publish the stable plugin and registry contracts

**Files:**
- Create: `packages/core/src/sdk/agent-plugin.ts`
- Modify: `packages/core/src/sdk/system-prompt.ts`
- Create: `packages/core/src/plugin-system/errors.ts`
- Modify: `packages/core/src/sdk/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/plugin-host.test.ts`

- [ ] **Step 1: Write a compile-level public API test**

Create `packages/core/tests/plugin-host.test.ts` with the first test proving consumers can import and implement the stable protocol:

```ts
import { describe, expect, it } from 'vitest';
import type {
  AgentPlugin,
  PluginRegistrationContext,
  PromptBuildContext,
  PromptSection,
} from 'rem-agent-core';
import { InvalidPluginNameError } from 'rem-agent-core';

const markerSection: PromptSection = {
  name: 'marker',
  render: (_ctx: PromptBuildContext) => 'marker',
};

describe('AgentPlugin public contract', () => {
  it('registers prompt sections synchronously', () => {
    const calls: string[] = [];
    const plugin: AgentPlugin = {
      name: 'example-plugin',
      register(context: PluginRegistrationContext): void {
        calls.push(plugin.name);
        context.systemPrompt.set(markerSection.name, markerSection);
      },
    };

    expect(plugin.name).toBe('example-plugin');
    expect(calls).toEqual([]);
    expect(new InvalidPluginNameError('Bad Name').pluginName).toBe('Bad Name');
  });
});
```

- [ ] **Step 2: Run the test to verify the public types are missing**

Run:

```bash
pnpm vitest run packages/core/tests/plugin-host.test.ts
```

Expected: FAIL during module loading because the runtime export `InvalidPluginNameError` does not exist yet.

- [ ] **Step 3: Add the stable SDK contracts**

Create `packages/core/src/sdk/agent-plugin.ts`:

```ts
import type { PromptSectionRegistry } from './system-prompt.js';

export interface PluginRegistrationContext {
  readonly systemPrompt: PromptSectionRegistry;
}

export interface AgentPlugin {
  readonly name: string;
  register(context: PluginRegistrationContext): void;
}
```

Append the registry contract to `packages/core/src/sdk/system-prompt.ts`:

```ts
export interface PromptSectionRegistry {
  set(name: string, section: PromptSection): void;
  delete(name: string): boolean;
  moveBefore(name: string, anchor: string): void;
  moveAfter(name: string, anchor: string): void;
  has(name: string): boolean;
}
```

Create `packages/core/src/plugin-system/errors.ts`:

```ts
export class InvalidPluginNameError extends Error {
  constructor(readonly pluginName: string) {
    super(`Invalid plugin name: ${pluginName}`);
    this.name = 'InvalidPluginNameError';
  }
}

export class DuplicatePluginNameError extends Error {
  constructor(readonly pluginName: string) {
    super(`Duplicate plugin name: ${pluginName}`);
    this.name = 'DuplicatePluginNameError';
  }
}

export class PromptSectionIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptSectionIdentityError';
  }
}

export class ProtectedPromptSectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectedPromptSectionError';
  }
}

export class PromptSectionNotFoundError extends Error {
  constructor(readonly sectionName: string) {
    super(`Prompt section not found: ${sectionName}`);
    this.name = 'PromptSectionNotFoundError';
  }
}

export class PluginRegistrationError extends Error {
  constructor(readonly pluginName: string, cause: unknown) {
    super(`Plugin registration failed: ${pluginName}`, { cause });
    this.name = 'PluginRegistrationError';
  }
}
```

Export both SDK files from `packages/core/src/sdk/index.ts`:

```ts
export * from './agent-plugin.js';
export * from './system-prompt.js';
```

Export the identifiable errors from `packages/core/src/index.ts`:

```ts
export * from './plugin-system/errors.js';
```

Remove the now-redundant final line that only exports `PromptBuildContext` from `packages/core/src/index.ts`, because `sdk/index.ts` exports all system-prompt contracts.

- [ ] **Step 4: Run the API test and typecheck**

Run:

```bash
pnpm vitest run packages/core/tests/plugin-host.test.ts
pnpm typecheck
```

Expected: the test PASSes and Core typecheck completes without errors.

- [ ] **Step 5: Commit the public contracts**

```bash
git add packages/core/src/sdk/agent-plugin.ts packages/core/src/sdk/system-prompt.ts packages/core/src/plugin-system/errors.ts packages/core/src/sdk/index.ts packages/core/src/index.ts packages/core/tests/plugin-host.test.ts
git commit -m "feat(core): define agent plugin prompt contracts"
```

### Task 2: Implement the transactional prompt section registry

**Files:**
- Create: `packages/core/src/system-prompt/section-registry.ts`
- Create: `packages/core/tests/prompt-section-registry.test.ts`

- [ ] **Step 1: Write failing tests for set, delete, movement, runtime protection, diagnostics, and rollback**

Create `packages/core/tests/prompt-section-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PromptSection } from 'rem-agent-core';
import {
  PromptSectionIdentityError,
  PromptSectionNotFoundError,
  ProtectedPromptSectionError,
} from 'rem-agent-core';
import { PromptSectionRegistryStore } from '../src/system-prompt/section-registry.js';

const section = (name: string, content = name): PromptSection => ({
  name,
  render: () => content,
});

describe('PromptSectionRegistryStore', () => {
  it('adds before runtime and replaces in place', () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('beta'), section('runtime'),
    ]);

    store.transact('plugin-a', (registry) => {
      registry.set('gamma', section('gamma'));
      registry.set('alpha', section('alpha', 'replaced'));
    });

    expect(store.finalize().map((item) => item.name)).toEqual([
      'alpha', 'beta', 'gamma', 'runtime',
    ]);
  });

  it('allows ordinary deletion and explicit movement', () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('beta'), section('runtime'),
    ]);

    store.transact('plugin-a', (registry) => {
      expect(registry.delete('missing')).toBe(false);
      expect(registry.delete('beta')).toBe(true);
      registry.set('gamma', section('gamma'));
      registry.moveBefore('gamma', 'alpha');
      registry.moveAfter('alpha', 'gamma');
    });

    expect(store.finalize().map((item) => item.name)).toEqual([
      'gamma', 'alpha', 'runtime',
    ]);
  });

  it('replaces runtime content without moving it', async () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('runtime', 'old'),
    ]);

    store.transact('plugin-a', (registry) => {
      registry.set('runtime', section('runtime', 'new'));
    });

    const snapshot = store.finalize();
    expect(snapshot.map((item) => item.name)).toEqual(['alpha', 'runtime']);
    expect(await snapshot[1].render({} as never)).toBe('new');
  });

  it('protects runtime position and existence', () => {
    const createStore = () => new PromptSectionRegistryStore([
      section('alpha'), section('runtime'),
    ]);

    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.delete('runtime');
    })).toThrow(ProtectedPromptSectionError);
    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.moveBefore('runtime', 'alpha');
    })).toThrow(ProtectedPromptSectionError);
    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.moveAfter('alpha', 'runtime');
    })).toThrow(ProtectedPromptSectionError);
  });

  it('rejects invalid identities and missing movement targets', () => {
    const createStore = () => new PromptSectionRegistryStore([
      section('alpha'), section('runtime'),
    ]);

    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.set('wrong', section('actual'));
    })).toThrow(PromptSectionIdentityError);
    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.moveBefore('missing', 'alpha');
    })).toThrow(PromptSectionNotFoundError);
    expect(() => createStore().transact('plugin-a', (registry) => {
      registry.moveBefore('alpha', 'missing');
    })).toThrow(PromptSectionNotFoundError);
  });

  it('rolls back a failed transaction and expires its registry view', () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('runtime'),
    ]);
    let retained: import('rem-agent-core').PromptSectionRegistry | undefined;

    expect(() => store.transact('plugin-a', (registry) => {
      retained = registry;
      registry.set('temporary', section('temporary'));
      throw new Error('stop');
    })).toThrow('stop');

    expect(store.finalize().map((item) => item.name)).toEqual(['alpha', 'runtime']);
    expect(() => retained?.set('late', section('late'))).toThrow('no longer active');
  });

  it('records replacement provenance without exposing mutable state', () => {
    const store = new PromptSectionRegistryStore([
      section('alpha'), section('runtime'),
    ]);
    store.transact('plugin-a', (registry) => registry.set('alpha', section('alpha', 'a')));
    store.transact('plugin-b', (registry) => registry.set('alpha', section('alpha', 'b')));

    expect(store.diagnostics()).toEqual([
      { name: 'alpha', source: 'plugin-b', history: ['core', 'plugin-a', 'plugin-b'] },
      { name: 'runtime', source: 'core', history: ['core'] },
    ]);
    expect(Object.isFrozen(store.finalize())).toBe(true);
  });
});
```

- [ ] **Step 2: Run the registry tests to verify they fail**

Run:

```bash
pnpm vitest run packages/core/tests/prompt-section-registry.test.ts
```

Expected: FAIL because `system-prompt/section-registry.ts` does not exist.

- [ ] **Step 3: Implement the registry store and short-lived transaction view**

Create `packages/core/src/system-prompt/section-registry.ts` with these concrete types and behavior:

```ts
import type { PromptSection, PromptSectionRegistry } from '../sdk/system-prompt.js';
import {
  PromptSectionIdentityError,
  PromptSectionNotFoundError,
  ProtectedPromptSectionError,
} from '../plugin-system/errors.js';

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const RUNTIME_SECTION = 'runtime';

interface SectionEntry {
  section: PromptSection;
  source: string;
  history: string[];
}

export interface PromptSectionDiagnostic {
  readonly name: string;
  readonly source: string;
  readonly history: readonly string[];
}

function cloneEntries(entries: readonly SectionEntry[]): SectionEntry[] {
  return entries.map((entry) => ({ ...entry, history: [...entry.history] }));
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new PromptSectionIdentityError(`Invalid prompt section name: ${name}`);
  }
}

class PromptSectionRegistryTransaction implements PromptSectionRegistry {
  private active = true;

  constructor(
    private readonly entries: SectionEntry[],
    private readonly source: string,
  ) {}

  set(name: string, section: PromptSection): void {
    this.assertActive();
    assertName(name);
    if (name !== section.name) {
      throw new PromptSectionIdentityError(
        `Prompt section identity mismatch: ${name} !== ${section.name}`,
      );
    }
    const current = this.entries.findIndex((entry) => entry.section.name === name);
    if (current >= 0) {
      const previous = this.entries[current];
      this.entries[current] = {
        section,
        source: this.source,
        history: [...previous.history, this.source],
      };
      return;
    }
    const runtime = this.indexOf(RUNTIME_SECTION);
    this.entries.splice(runtime, 0, {
      section,
      source: this.source,
      history: [this.source],
    });
  }

  delete(name: string): boolean {
    this.assertActive();
    if (name === RUNTIME_SECTION) {
      throw new ProtectedPromptSectionError('runtime cannot be deleted');
    }
    const index = this.entries.findIndex((entry) => entry.section.name === name);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  moveBefore(name: string, anchor: string): void {
    this.move(name, anchor, false);
  }

  moveAfter(name: string, anchor: string): void {
    this.move(name, anchor, true);
  }

  has(name: string): boolean {
    this.assertActive();
    return this.entries.some((entry) => entry.section.name === name);
  }

  finish(): SectionEntry[] {
    this.assertActive();
    this.active = false;
    return cloneEntries(this.entries);
  }

  abort(): void {
    this.active = false;
  }

  private move(name: string, anchor: string, after: boolean): void {
    this.assertActive();
    if (name === RUNTIME_SECTION) {
      throw new ProtectedPromptSectionError('runtime cannot be moved');
    }
    if (after && anchor === RUNTIME_SECTION) {
      throw new ProtectedPromptSectionError('no section can move after runtime');
    }
    const sourceIndex = this.indexOf(name);
    this.indexOf(anchor);
    if (name === anchor) return;
    const [entry] = this.entries.splice(sourceIndex, 1);
    const anchorIndex = this.indexOf(anchor);
    this.entries.splice(anchorIndex + (after ? 1 : 0), 0, entry);
  }

  private indexOf(name: string): number {
    const index = this.entries.findIndex((entry) => entry.section.name === name);
    if (index < 0) throw new PromptSectionNotFoundError(name);
    return index;
  }

  private assertActive(): void {
    if (!this.active) throw new Error('Prompt section registry view is no longer active');
  }
}

export class PromptSectionRegistryStore {
  private entries: SectionEntry[];

  constructor(sections: readonly PromptSection[]) {
    const names = new Set<string>();
    for (const section of sections) {
      assertName(section.name);
      if (names.has(section.name)) {
        throw new PromptSectionIdentityError(`Duplicate prompt section: ${section.name}`);
      }
      names.add(section.name);
    }
    if (sections.at(-1)?.name !== RUNTIME_SECTION) {
      throw new ProtectedPromptSectionError('runtime must be the final prompt section');
    }
    this.entries = sections.map((section) => ({
      section, source: 'core', history: ['core'],
    }));
  }

  transact(source: string, apply: (registry: PromptSectionRegistry) => void): void {
    const transaction = new PromptSectionRegistryTransaction(cloneEntries(this.entries), source);
    try {
      apply(transaction);
      this.entries = transaction.finish();
    } catch (error) {
      transaction.abort();
      throw error;
    }
  }

  finalize(): readonly PromptSection[] {
    return Object.freeze(this.entries.map((entry) => entry.section));
  }

  diagnostics(): readonly PromptSectionDiagnostic[] {
    return this.entries.map((entry) => Object.freeze({
      name: entry.section.name,
      source: entry.source,
      history: Object.freeze([...entry.history]),
    }));
  }
}
```

Keep this file under the project implementation-file hard limit. If formatting pushes it over 200 lines, extract only the transaction class to `system-prompt/section-registry-transaction.ts`; do not combine unrelated plugin-host logic into this file.

- [ ] **Step 4: Run registry tests and structure check**

Run:

```bash
pnpm vitest run packages/core/tests/prompt-section-registry.test.ts
pnpm check:structure
```

Expected: registry tests PASS. Structure check may still report only the two documented pre-existing violations (`agent/rem-agent.ts` length and `agent → plugins` dependency); it must report no new violation.

- [ ] **Step 5: Commit the registry**

```bash
git add packages/core/src/system-prompt/section-registry.ts packages/core/tests/prompt-section-registry.test.ts
git commit -m "feat(core): add transactional prompt section registry"
```

### Task 3: Execute plugins in order with rollback and identifiable errors

**Files:**
- Create: `packages/core/src/plugin-system/plugin-host.ts`
- Modify: `packages/core/tests/plugin-host.test.ts`

- [ ] **Step 1: Add failing behavior tests to the plugin-host suite**

Append these imports and tests to `packages/core/tests/plugin-host.test.ts`:

```ts
import {
  DuplicatePluginNameError,
  InvalidPluginNameError,
  PluginRegistrationError,
  ProtectedPromptSectionError,
} from 'rem-agent-core';
import { applyAgentPlugins } from '../src/plugin-system/plugin-host.js';
import { PromptSectionRegistryStore } from '../src/system-prompt/section-registry.js';

const coreSections = (): PromptSection[] => [
  { name: 'base', render: () => 'base' },
  { name: 'runtime', render: () => 'runtime' },
];

describe('applyAgentPlugins', () => {
  it('applies plugins in array order with last-write-wins', async () => {
    const store = new PromptSectionRegistryStore(coreSections());
    const plugins: AgentPlugin[] = [
      {
        name: 'plugin-a',
        register: ({ systemPrompt }) => systemPrompt.set(
          'base', { name: 'base', render: () => 'a' },
        ),
      },
      {
        name: 'plugin-b',
        register: ({ systemPrompt }) => systemPrompt.set(
          'base', { name: 'base', render: () => 'b' },
        ),
      },
    ];

    applyAgentPlugins(store, plugins);

    expect(await store.finalize()[0].render({} as never)).toBe('b');
    expect(store.diagnostics()[0].history).toEqual(['core', 'plugin-a', 'plugin-b']);
  });

  it('rejects invalid and duplicate plugin names before partial execution', () => {
    const invalid = new PromptSectionRegistryStore(coreSections());
    expect(() => applyAgentPlugins(invalid, [{ name: 'Bad Name', register: () => {} }]))
      .toThrow(InvalidPluginNameError);

    const duplicate = new PromptSectionRegistryStore(coreSections());
    expect(() => applyAgentPlugins(duplicate, [
      { name: 'same', register: () => {} },
      { name: 'same', register: () => {} },
    ])).toThrow(DuplicatePluginNameError);
    expect(duplicate.diagnostics().every((item) => item.source === 'core')).toBe(true);
  });

  it('wraps plugin errors and rolls back all operations from that plugin', () => {
    const store = new PromptSectionRegistryStore(coreSections());

    expect(() => applyAgentPlugins(store, [{
      name: 'broken-plugin',
      register({ systemPrompt }) {
        systemPrompt.set('temporary', { name: 'temporary', render: () => 'temporary' });
        systemPrompt.delete('runtime');
      },
    }])).toThrow(PluginRegistrationError);

    try {
      applyAgentPlugins(new PromptSectionRegistryStore(coreSections()), [{
        name: 'broken-plugin',
        register: ({ systemPrompt }) => systemPrompt.delete('runtime'),
      }]);
    } catch (error) {
      expect(error).toBeInstanceOf(PluginRegistrationError);
      expect((error as PluginRegistrationError).pluginName).toBe('broken-plugin');
      expect((error as Error).cause).toBeInstanceOf(ProtectedPromptSectionError);
    }
    expect(store.finalize().map((item) => item.name)).toEqual(['base', 'runtime']);
  });
});
```

- [ ] **Step 2: Run the plugin-host tests to verify they fail**

Run:

```bash
pnpm vitest run packages/core/tests/plugin-host.test.ts
```

Expected: FAIL because `plugin-system/plugin-host.ts` does not exist.

- [ ] **Step 3: Implement the focused plugin host**

Create `packages/core/src/plugin-system/plugin-host.ts`:

```ts
import type { AgentPlugin } from '../sdk/agent-plugin.js';
import type { PromptSectionRegistryStore } from '../system-prompt/section-registry.js';
import {
  DuplicatePluginNameError,
  InvalidPluginNameError,
  PluginRegistrationError,
} from './errors.js';

const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function applyAgentPlugins(
  systemPrompt: PromptSectionRegistryStore,
  plugins: readonly AgentPlugin[],
): void {
  const names = new Set<string>();
  for (const plugin of plugins) {
    if (!PLUGIN_NAME_PATTERN.test(plugin.name)) {
      throw new InvalidPluginNameError(plugin.name);
    }
    if (names.has(plugin.name)) {
      throw new DuplicatePluginNameError(plugin.name);
    }
    names.add(plugin.name);
  }

  for (const plugin of plugins) {
    try {
      systemPrompt.transact(plugin.name, (registry) => {
        plugin.register({ systemPrompt: registry });
      });
    } catch (error) {
      throw new PluginRegistrationError(plugin.name, error);
    }
  }
}
```

- [ ] **Step 4: Run the focused tests and typecheck**

Run:

```bash
pnpm vitest run packages/core/tests/plugin-host.test.ts packages/core/tests/prompt-section-registry.test.ts
pnpm typecheck
```

Expected: all focused tests PASS and typecheck succeeds.

- [ ] **Step 5: Commit the plugin host**

```bash
git add packages/core/src/plugin-system/plugin-host.ts packages/core/tests/plugin-host.test.ts
git commit -m "feat(core): compose agent plugins transactionally"
```

### Task 4: Inject the finalized prompt assembler through AgentDI

**Files:**
- Create: `packages/core/src/system-prompt/default-sections.ts`
- Modify: `packages/core/src/system-prompt/assembler.ts`
- Modify: `packages/core/src/system-prompt/default-assembler.ts`
- Modify: `packages/core/src/assembly/agent-di.ts`
- Modify: `packages/core/src/assembly/types.ts`
- Modify: `packages/core/src/assembly/agent-assembly.ts`
- Modify: `packages/core/src/assembly/agent-context-assembler.ts`
- Modify: `packages/core/src/agent/context/resolve-system-prompt.ts`
- Modify: `packages/core/tests/helpers/fake-di.ts`
- Create: `packages/core/tests/system-prompt-plugin.test.ts`

- [ ] **Step 1: Write failing integration tests through the real assembly path**

First add `plugins?: readonly AgentPlugin[]` to `FakeAssemblyOptions` and pass it into `createAgentAssembly()` in `packages/core/tests/helpers/fake-di.ts`. Import `AgentPlugin` as a type from `rem-agent-core`.

Then create `packages/core/tests/system-prompt-plugin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AgentPlugin, PromptSection } from 'rem-agent-core';
import { resolveSystemPrompt } from '../src/agent/context/resolve-system-prompt.js';
import { createFakeAssembly } from './helpers/fake-di.js';

const plugin: AgentPlugin = {
  name: 'prompt-customizer',
  register({ systemPrompt }) {
    systemPrompt.delete('safety');
    systemPrompt.set('company-policy', {
      name: 'company-policy',
      render: () => '## Company Policy\n\nUse the internal policy.',
    });
    systemPrompt.set('runtime', {
      name: 'runtime',
      render: (ctx) => `## Runtime Override\n\n${ctx.agentName}`,
    });
  },
};

async function renderPrompt(plugins: readonly AgentPlugin[] = []): Promise<string> {
  const { di, runtimeConfig } = await createFakeAssembly({ plugins });
  const configProvider = di.configProvider;
  return resolveSystemPrompt({
    di,
    runtimeConfig,
    resolution: {
      behavior: configProvider.getBehaviorConfig(),
      configProvider,
      effectiveModel: configProvider.getModelConfig(),
      agentRole: configProvider.resolveAgent(),
      workspaceRoot: '/',
    },
  });
}

describe('system prompt plugins', () => {
  it('preserves default behavior without plugins and keeps runtime last', async () => {
    const prompt = await renderPrompt();
    expect(prompt).toContain('## Safety');
    expect(prompt).toContain('## Runtime');
    const headings = [...prompt.matchAll(/^## .+$/gm)].map((match) => match[0]);
    expect(headings.at(-1)).toBe('## Runtime');
  });

  it('applies additions, deletion, and runtime replacement through AgentDI', async () => {
    const prompt = await renderPrompt([plugin]);
    expect(prompt).not.toContain('## Safety');
    expect(prompt).toContain('## Company Policy\n\nUse the internal policy.');
    expect(prompt.trimEnd().endsWith('## Runtime Override\n\nTestAgent')).toBe(true);
  });

  it('keeps the assembler snapshot stable after assembly', async () => {
    let retained: import('rem-agent-core').PromptSectionRegistry | undefined;
    const retainingPlugin: AgentPlugin = {
      name: 'retaining-plugin',
      register({ systemPrompt }) {
        retained = systemPrompt;
        systemPrompt.set('marker', { name: 'marker', render: () => 'initial marker' });
      },
    };
    const first = await renderPrompt([retainingPlugin]);
    expect(() => retained?.set('late', {
      name: 'late', render: () => 'late marker',
    } as PromptSection)).toThrow('no longer active');
    expect(first).toContain('initial marker');
    expect(first).not.toContain('late marker');
  });
});
```

- [ ] **Step 2: Run integration tests to verify they fail**

Run:

```bash
pnpm vitest run packages/core/tests/system-prompt-plugin.test.ts
```

Expected: FAIL because assembly options do not accept plugins and `AgentDI` does not contain `systemPromptAssembler`.

- [ ] **Step 3: Extract default section construction**

Create `packages/core/src/system-prompt/default-sections.ts`:

```ts
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { PromptSection } from '../sdk/system-prompt.js';
import { ProjectAgentsMdLoader } from './loaders/project-agents-md-loader.js';
import { AgentsMdSection } from './sections/agents-md-section.js';
import { ExecutionBiasSection } from './sections/execution-bias-section.js';
import { RuntimeSection } from './sections/runtime-section.js';
import { SafetySection } from './sections/safety-section.js';
import { SkillsSection } from './sections/skills-section.js';
import { ToolingSection } from './sections/tooling-section.js';
import { WorkspaceSection } from './sections/workspace-section.js';

export function createDefaultPromptSections(skillProvider: SkillProvider): PromptSection[] {
  return [
    new ToolingSection(),
    new ExecutionBiasSection(),
    new SafetySection(),
    new AgentsMdSection(new ProjectAgentsMdLoader()),
    new SkillsSection(skillProvider),
    new WorkspaceSection(),
    new RuntimeSection(),
  ];
}
```

The array preserves current output for compatibility, but tests and public contracts must not promise the relative order of ordinary sections.

- [ ] **Step 4: Make the default assembler plugin-aware**

First change the constructor field in `packages/core/src/system-prompt/assembler.ts` so it accepts the immutable snapshot without a cast:

```ts
export class DefaultSystemPromptAssembler implements SystemPromptAssembler {
  constructor(
    private readonly templateSelector: AgentPromptTemplateSelector,
    private readonly sections: readonly PromptSection[],
  ) {}

  // assemble() remains unchanged
}
```

Replace the section imports and factory body in `packages/core/src/system-prompt/default-assembler.ts` with:

```ts
import type { AgentPlugin } from '../sdk/agent-plugin.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import { applyAgentPlugins } from '../plugin-system/plugin-host.js';
import { DefaultSystemPromptAssembler } from './assembler.js';
import { createDefaultPromptSections } from './default-sections.js';
import { PromptSectionRegistryStore } from './section-registry.js';
import { ProviderAwareTemplateSelector } from './template-selector.js';
import { ClaudeAgentPromptTemplate } from './templates/claude-template.js';
import { OpenAiAgentPromptTemplate } from './templates/openai-template.js';

export function createDefaultSystemPromptAssembler(
  skillProvider: SkillProvider,
  plugins: readonly AgentPlugin[] = [],
): DefaultSystemPromptAssembler {
  const sections = new PromptSectionRegistryStore(createDefaultPromptSections(skillProvider));
  applyAgentPlugins(sections, plugins);
  return new DefaultSystemPromptAssembler(
    new ProviderAwareTemplateSelector(
      new ClaudeAgentPromptTemplate(),
      { openai: new OpenAiAgentPromptTemplate() },
    ),
    sections.finalize(),
  );
}
```

- [ ] **Step 5: Thread plugins through assembly and inject the assembler**

Apply these exact type-level changes:

```ts
// assembly/agent-di.ts
import type { SystemPromptAssembler } from '../sdk/system-prompt.js';

export interface AgentDI {
  // existing fields unchanged
  systemPromptAssembler: SystemPromptAssembler;
}
```

```ts
// assembly/types.ts
import type { AgentPlugin } from '../sdk/agent-plugin.js';

export interface AssembleAgentContextOptions {
  // existing fields unchanged
  plugins?: readonly AgentPlugin[];
}
```

```ts
// assembly/agent-assembly.ts
import type { AgentPlugin } from '../sdk/agent-plugin.js';

export interface AgentContextBuildOptions {
  // existing fields unchanged
  plugins?: readonly AgentPlugin[];
}
```

Pass `plugins: options?.plugins` from `createAgentAssembly()` into `assembleAgentContext()`.

In `packages/core/src/assembly/agent-context-assembler.ts`, import `createDefaultSystemPromptAssembler` and add this property while constructing `di`:

```ts
systemPromptAssembler: createDefaultSystemPromptAssembler(
  options.skillProvider ?? new EmptySkillProvider(),
  options.plugins,
),
```

Avoid constructing two different fallback `EmptySkillProvider` instances. Resolve `skillProvider` once before the return and use that same instance for both `di.skillProvider` and the assembler:

```ts
const skillProvider = options.skillProvider ?? new EmptySkillProvider();
```

- [ ] **Step 6: Make runtime prompt resolution consume DI**

In `packages/core/src/agent/context/resolve-system-prompt.ts`:

- Remove the `createDefaultSystemPromptAssembler` import.
- Replace the final expression with:

```ts
return di.systemPromptAssembler.assemble(buildCtx);
```

Do not change context loading, tool summaries, skill loading, or the child-agent explicit system-prompt override.

- [ ] **Step 7: Run focused integration and regression tests**

Run:

```bash
pnpm vitest run packages/core/tests/system-prompt-plugin.test.ts packages/core/tests/rem-agent-assembly.test.ts packages/core/tests/plugin-host.test.ts packages/core/tests/prompt-section-registry.test.ts
```

Expected: all focused tests PASS. If the no-plugin assertion fails because it relied on an ordinary section order, rewrite only that assertion to check default presence plus `runtime` finality.

- [ ] **Step 8: Commit assembly integration**

```bash
git add packages/core/src/system-prompt/default-sections.ts packages/core/src/system-prompt/assembler.ts packages/core/src/system-prompt/default-assembler.ts packages/core/src/assembly/agent-di.ts packages/core/src/assembly/types.ts packages/core/src/assembly/agent-assembly.ts packages/core/src/assembly/agent-context-assembler.ts packages/core/src/agent/context/resolve-system-prompt.ts packages/core/tests/helpers/fake-di.ts packages/core/tests/system-prompt-plugin.test.ts
git commit -m "feat(core): assemble system prompt plugins"
```

### Task 5: Document and verify the complete boundary

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/module-reference.md`

- [ ] **Step 1: Update architecture documentation**

In `docs/architecture.md`, add `plugin-system/` to the Core source tree with the description “装配期 Agent 插件执行、事务与错误边界”. Add these boundary statements near the existing SDK/plugin rules:

```markdown
- `AgentDI` 持有已完成装配的运行时能力；`AgentPlugin` 只参与装配，不进入 Agent 执行生命周期。
- `plugin-system/` 执行统一插件协议，`plugins/` 仍表示 SDK Provider 的内置实现，两者不可混用。
- System prompt 插件通过具名 section registry 贡献内容；`runtime` 内容可替换，但始终是最后一个 section。
```

- [ ] **Step 2: Update the module reference**

In `docs/module-reference.md`:

- Add a `plugin-system/` section naming `plugin-host.ts` and `errors.ts`.
- Update `assembly/` to mention plugin-aware prompt assembler construction.
- Update `sdk/` to list `AgentPlugin`, `PromptSectionRegistry`, and `SystemPromptAssembler`.
- Update `system-prompt/` to mention default-section creation and the transactional registry.

- [ ] **Step 3: Run the full required verification suite**

Run exactly:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm check:structure
```

Expected:

- `pnpm build`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm test`: PASS with all Core tests.
- `pnpm check:structure`: no new violations; the only tolerated failures are the two AGENTS.md-documented existing issues (`agent/rem-agent.ts` length and `agent → plugins` dependency). If its exit code is non-zero, capture and report the exact output instead of claiming a clean pass.

- [ ] **Step 4: Inspect the final diff for scope and accidental API drift**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~3..HEAD
rg -n "createDefaultSystemPromptAssembler" packages/core/src
```

Expected:

- `git diff --check` prints nothing.
- Only the files listed in this plan are modified.
- `createDefaultSystemPromptAssembler` is referenced by assembly and its own definition, not by `resolve-system-prompt.ts`.
- No files under `archive/` are changed.

- [ ] **Step 5: Commit documentation and final verification state**

```bash
git add docs/architecture.md docs/module-reference.md
git commit -m "docs: document agent plugin assembly boundary"
```

If verification required a code or test correction, include those corrected files in this commit only when they are inseparable from documentation; otherwise create a focused fix commit before the documentation commit.
