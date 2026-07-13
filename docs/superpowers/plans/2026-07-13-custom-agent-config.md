# Custom Agent Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to define custom agents in `rem-agent.config.json` with `name`, `corePrompt`, and optional `model`; switch agents at runtime via `runAgent({ ..., agent: 'id' })` with fallback to a built-in default agent.

**Architecture:** Extend the existing `ConfigProvider` with an `AgentResolver` that merges a built-in default agent with user-defined agents from config. Pass the resolved `agentName` and `agentCorePrompt` into the `SystemPromptAssembler`/`PromptBuildContext`, and apply the resolved model override inside `runAgent`.

**Tech Stack:** TypeScript, Vitest, pnpm workspace (`rem-agent-core`)

---

## File Map

| File | Responsibility |
|---|---|
| `packages/core/src/sdk/agent-role.ts` (new) | `CustomAgentConfig`, `ResolvedAgentRole`, `AgentResolver` interface. |
| `packages/core/src/agent-resolver.ts` (new) | `AgentResolver` implementation: merges built-in default + user agents, handles fallback. |
| `packages/core/src/system-prompt/variables/agent-role-variables.ts` (new) | Replace `{{agentName}}` and `{{agentRolePrompt}}` in template strings. |
| `packages/core/src/sdk/config-provider.ts` (mod) | Add `agents` to `AgentConfig`; add `resolveAgent` to `ConfigProvider`. |
| `packages/core/src/sdk/system-prompt.ts` (mod) | Add `agentName`, `agentCorePrompt` to `PromptBuildContext`. |
| `packages/core/src/plugins/config/default/config-parser.ts` (mod) | Add `pickAgents` / `pickCustomAgentConfig` parsers. |
| `packages/core/src/plugins/config/default/config-merger.ts` (mod) | Merge `agents` from file/env/overrides. |
| `packages/core/src/plugins/config/default/index.ts` (mod) | Instantiate `AgentResolver` and expose `resolveAgent`. |
| `packages/core/src/system-prompt/templates/claude-template.md` (mod) | Split fixed identity sentence from `{{agentRolePrompt}}`. |
| `packages/core/src/system-prompt/templates/claude-template.ts` (mod) | Replace new variables using the variables helper. |
| `packages/core/src/system-prompt/templates/openai-template.md` (mod) | Sync structure with Claude template. |
| `packages/core/src/system-prompt/templates/openai-template.ts` (mod) | Replace new variables using the variables helper. |
| `packages/core/src/run-agent.ts` (mod) | Add `agent` param; resolve agent; apply model override and system prompt. |
| `packages/core/tests/agent-resolver.test.ts` (new) | Unit tests for `AgentResolver`. |
| `packages/core/tests/agent-role-variables.test.ts` (new) | Unit tests for variable replacement. |
| `packages/core/tests/run-agent-custom.test.ts` (new) | Integration tests for `runAgent` with custom agents. |

---

### Task 1: Define Agent Role Types and Extend ConfigProvider Interface

**Files:**
- Create: `packages/core/src/sdk/agent-role.ts`
- Modify: `packages/core/src/sdk/config-provider.ts`
- Test: `packages/core/tests/agent-resolver.test.ts` (failing import only for now)

- [ ] **Step 1: Create `packages/core/src/sdk/agent-role.ts`**

```typescript
import type { AgentModelConfig, ResolvedModelConfig } from './config-provider.js';

export interface CustomAgentConfig {
  name: string;
  corePrompt: string;
  model?: AgentModelConfig;
}

export interface ResolvedAgentRole {
  id: string;
  name: string;
  corePrompt: string;
  model?: ResolvedModelConfig;
}

export interface AgentResolver {
  resolveAgent(id?: string): ResolvedAgentRole;
}
```

- [ ] **Step 2: Extend `ConfigProvider` in `packages/core/src/sdk/config-provider.ts`**

Add to `AgentConfig`:

```typescript
export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  // ... existing fields ...
  agents?: Record<string, CustomAgentConfig>;
}
```

Add to imports at the top of the file:

```typescript
import type { CustomAgentConfig, ResolvedAgentRole } from './agent-role.js';
```

Add to `ConfigProvider` interface:

```typescript
export interface ConfigProvider {
  // ... existing methods ...
  resolveAgent(id?: string): ResolvedAgentRole;
}
```

- [ ] **Step 3: Create a stub test file to verify imports work**

Create `packages/core/tests/agent-resolver.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('AgentResolver', () => {
  it('should be importable', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter rem-agent-core test -- packages/core/tests/agent-resolver.test.ts
```

Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sdk/agent-role.ts packages/core/src/sdk/config-provider.ts packages/core/tests/agent-resolver.test.ts
git commit -m "feat(config): define agent role types and ConfigProvider extension"
```

---

### Task 2: Parse and Merge `agents` Config

**Files:**
- Modify: `packages/core/src/plugins/config/default/config-parser.ts`
- Modify: `packages/core/src/plugins/config/default/config-merger.ts`
- Test: `packages/core/tests/config-parser.test.ts` (or create if missing)

- [ ] **Step 1: Add parsers in `packages/core/src/plugins/config/default/config-parser.ts`**

Add imports:

```typescript
import type { CustomAgentConfig, AgentModelConfig } from '../../../sdk/agent-role.js';
```

Add functions:

```typescript
export function pickCustomAgentConfig(raw: unknown): CustomAgentConfig | undefined {
  if (!isObject(raw)) return undefined;
  if (typeof raw.name !== 'string') return undefined;
  if (typeof raw.corePrompt !== 'string') return undefined;
  const cfg: CustomAgentConfig = {
    name: raw.name,
    corePrompt: raw.corePrompt,
  };
  const model = pickModelConfig(raw.model);
  if (model) cfg.model = model;
  return cfg;
}

export function pickAgents(raw: unknown): Record<string, CustomAgentConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const result: Record<string, CustomAgentConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    const agent = pickCustomAgentConfig(value);
    if (agent) result[key] = agent;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
```

- [ ] **Step 2: Merge `agents` in `packages/core/src/plugins/config/default/config-merger.ts`**

Add imports:

```typescript
import type { CustomAgentConfig } from '../../../sdk/agent-role.js';
import { pickAgents } from './config-parser.js';
```

Update `mergeFileConfig` to include:

```typescript
const agents = pickAgents(file.agents);
if (agents) merged.agents = { ...merged.agents, ...agents };
```

Update `mergeDeepConfig` to merge agents deeply:

```typescript
export function mergeDeepConfig(base: AgentConfig, file: Record<string, unknown>): AgentConfig {
  const merged = mergeFileConfig(base, file);
  const toolPolicy = pickToolPolicy(file.toolPolicy);
  if (toolPolicy && base.toolPolicy) {
    merged.toolPolicy = mergeToolPolicy(base.toolPolicy, toolPolicy);
  }
  if (base.agents && merged.agents) {
    merged.agents = { ...base.agents, ...merged.agents };
  }
  return merged;
}
```

Update `mergeOverrides` to merge agents:

```typescript
if (overrides.agents && base.agents) {
  merged.agents = { ...base.agents, ...overrides.agents };
}
```

- [ ] **Step 3: Write a test for parsing and merging agents**

Create or append to `packages/core/tests/config-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickAgents } from '../src/plugins/config/default/config-parser.js';
import { mergeFileConfig } from '../src/plugins/config/default/config-merger.js';

describe('pickAgents', () => {
  it('returns valid agents map', () => {
    const result = pickAgents({
      coder: { name: 'Coder', corePrompt: 'Write code.', model: { provider: 'openai', model: 'gpt-4o' } },
      invalid: { name: 'OnlyName' },
    });
    expect(result).toHaveProperty('coder');
    expect(result).not.toHaveProperty('invalid');
    expect(result!.coder.name).toBe('Coder');
    expect(result!.coder.corePrompt).toBe('Write code.');
    expect(result!.coder.model).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });
});

describe('mergeFileConfig agents', () => {
  it('merges agents from file', () => {
    const merged = mergeFileConfig({}, { agents: { coder: { name: 'Coder', corePrompt: 'Code.' } } });
    expect(merged.agents?.coder.name).toBe('Coder');
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter rem-agent-core test -- packages/core/tests/config-parser.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/config/default/config-parser.ts packages/core/src/plugins/config/default/config-merger.ts packages/core/tests/config-parser.test.ts
git commit -m "feat(config): parse and merge agents config"
```

---

### Task 3: Implement AgentResolver

**Files:**
- Create: `packages/core/src/agent-resolver.ts`
- Test: `packages/core/tests/agent-resolver.test.ts`

- [ ] **Step 1: Create `packages/core/src/agent-resolver.ts`**

```typescript
import type { AgentResolver, CustomAgentConfig, ResolvedAgentRole } from './sdk/agent-role.js';
import type { AgentBehaviorConfig, ResolvedModelConfig } from './sdk/config-provider.js';
import { log } from './shared/debug-log.js';

export interface AgentResolverOptions {
  behavior: Required<AgentBehaviorConfig>;
  agents?: Record<string, CustomAgentConfig>;
  resolveModel(model: CustomAgentConfig['model']): ResolvedModelConfig | undefined;
}

export class DefaultAgentResolver implements AgentResolver {
  private readonly defaultRole: ResolvedAgentRole;
  private readonly agents: Map<string, ResolvedAgentRole>;

  constructor(private options: AgentResolverOptions) {
    this.defaultRole = this.buildDefaultRole();
    this.agents = this.buildAgentMap();
  }

  resolveAgent(id?: string): ResolvedAgentRole {
    if (id === undefined || id === '') return this.defaultRole;
    const role = this.agents.get(id);
    if (!role) {
      log('agent-resolver', 'unknown agent, fallback to default', { id });
      return this.defaultRole;
    }
    return role;
  }

  private buildDefaultRole(): ResolvedAgentRole {
    const userDefault = this.options.agents?.default;
    return {
      id: 'default',
      name: userDefault?.name ?? this.options.behavior.name,
      corePrompt: userDefault?.corePrompt ?? 'You help users with software engineering and daily tasks by using the tools available to you.',
      model: userDefault?.model ? this.options.resolveModel(userDefault.model) : undefined,
    };
  }

  private buildAgentMap(): Map<string, ResolvedAgentRole> {
    const map = new Map<string, ResolvedAgentRole>();
    for (const [id, cfg] of Object.entries(this.options.agents ?? {})) {
      if (id === 'default') continue;
      if (!cfg.name || !cfg.corePrompt) {
        log('agent-resolver', 'invalid agent config, skipped', { id });
        continue;
      }
      map.set(id, {
        id,
        name: cfg.name,
        corePrompt: cfg.corePrompt,
        model: cfg.model ? this.options.resolveModel(cfg.model) : undefined,
      });
    }
    return map;
  }
}
```

- [ ] **Step 2: Replace stub test in `packages/core/tests/agent-resolver.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { DefaultAgentResolver } from '../src/agent-resolver.js';

const baseBehavior = {
  name: 'Rem Agent',
  maxTurns: 60,
  workspaceRoot: '/tmp',
  readOnly: false,
  autoApproveDangerous: false,
  sessionsDir: '/tmp/sessions',
  profile: 'coding' as const,
  sessionRules: [],
};

describe('DefaultAgentResolver', () => {
  it('returns default role when no id is given', () => {
    const resolver = new DefaultAgentResolver({ behavior: baseBehavior });
    const role = resolver.resolveAgent();
    expect(role.id).toBe('default');
    expect(role.name).toBe('Rem Agent');
  });

  it('returns custom agent when id matches', () => {
    const resolver = new DefaultAgentResolver({
      behavior: baseBehavior,
      agents: {
        coder: { name: 'Code Assistant', corePrompt: 'Focus on code.' },
      },
      resolveModel: () => undefined,
    });
    const role = resolver.resolveAgent('coder');
    expect(role.id).toBe('coder');
    expect(role.name).toBe('Code Assistant');
    expect(role.corePrompt).toBe('Focus on code.');
  });

  it('falls back to default for unknown id', () => {
    const resolver = new DefaultAgentResolver({ behavior: baseBehavior });
    const role = resolver.resolveAgent('unknown');
    expect(role.id).toBe('default');
  });

  it('skips invalid agent missing corePrompt', () => {
    const resolver = new DefaultAgentResolver({
      behavior: baseBehavior,
      agents: {
        bad: { name: 'Bad', corePrompt: '' },
      } as any,
      resolveModel: () => undefined,
    });
    const role = resolver.resolveAgent('bad');
    expect(role.id).toBe('default');
  });

  it('overrides default when agents.default is provided', () => {
    const resolver = new DefaultAgentResolver({
      behavior: baseBehavior,
      agents: {
        default: { name: 'Custom Default', corePrompt: 'Custom default prompt.' },
      },
      resolveModel: () => undefined,
    });
    const role = resolver.resolveAgent();
    expect(role.name).toBe('Custom Default');
    expect(role.corePrompt).toBe('Custom default prompt.');
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
pnpm --filter rem-agent-core test -- packages/core/tests/agent-resolver.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent-resolver.ts packages/core/tests/agent-resolver.test.ts
git commit -m "feat(config): implement DefaultAgentResolver"
```

---

### Task 4: Integrate AgentResolver into DefaultConfigProvider

**Files:**
- Modify: `packages/core/src/plugins/config/default/index.ts`

- [ ] **Step 1: Import and initialize `AgentResolver`**

Add import:

```typescript
import { DefaultAgentResolver } from '../../../agent-resolver.js';
import type { AgentResolver } from '../../../sdk/agent-role.js';
```

Add private field to `DefaultConfigProvider`:

```typescript
private agentResolver?: AgentResolver;
```

In `init()`, after `this.raw = config;`, add:

```typescript
this.agentResolver = new DefaultAgentResolver({
  behavior: this.getBehaviorConfig(),
  agents: this.raw.agents,
  resolveModel: (model) => {
    if (!model || !model.provider || !model.model) return undefined;
    return this.resolveModelConfig(model);
  },
});
```

- [ ] **Step 2: Extract raw model resolution helper**

Add a private method to `DefaultConfigProvider`:

```typescript
private resolveModelConfig(model: AgentModelConfig): ResolvedModelConfig {
  const resolvedModel = model.model || this.readProviderEnv(model.provider, 'MODEL') || '';
  const resolvedBaseURL =
    resolveOptionalTemplate(model.baseURL, this.env) ??
    this.readProviderEnv(model.provider, 'BASE_URL');
  return {
    provider: model.provider,
    model: resolvedModel,
    apiKey: this.resolveApiKey(model),
    baseURL: resolvedBaseURL,
  };
}
```

Then update `getModelConfig` to use it:

```typescript
getModelConfig(modelId?: string): ResolvedModelConfig {
  const cfg = this.getRawConfig();
  const id = modelId ?? cfg.activeModel ?? 'default';
  const model = cfg.models?.[id] ?? cfg.model ?? { provider: 'openai', model: '' };
  return this.resolveModelConfig(model);
}
```

And the `AgentResolver` initialization:

```typescript
this.agentResolver = new DefaultAgentResolver({
  behavior: this.getBehaviorConfig(),
  agents: this.raw.agents,
  resolveModel: (model) => {
    if (!model || !model.provider || !model.model) return undefined;
    return this.resolveModelConfig(model);
  },
});
```

- [ ] **Step 3: Implement `resolveAgent`**

Add to `DefaultConfigProvider`:

```typescript
resolveAgent(id?: string): ResolvedAgentRole {
  if (!this.agentResolver) {
    throw new Error('DefaultConfigProvider must be initialized before resolving agent');
  }
  return this.agentResolver.resolveAgent(id);
}
```

- [ ] **Step 4: Verify with an existing config test**

Run existing tests to ensure no regression:

```bash
pnpm --filter rem-agent-core test -- packages/core/tests/agent-factory.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/config/default/index.ts
git commit -m "feat(config): integrate AgentResolver into DefaultConfigProvider"
```

---

### Task 5: Extend PromptBuildContext and Create Variable Replacement Helper

**Files:**
- Modify: `packages/core/src/sdk/system-prompt.ts`
- Create: `packages/core/src/system-prompt/variables/agent-role-variables.ts`
- Test: `packages/core/tests/agent-role-variables.test.ts`

- [ ] **Step 1: Extend `PromptBuildContext`**

In `packages/core/src/sdk/system-prompt.ts`, add to `PromptBuildContext`:

```typescript
export interface PromptBuildContext {
  // ... existing fields ...
  agentName: string;
  agentCorePrompt: string;
}
```

- [ ] **Step 2: Create variable replacement helper**

Create `packages/core/src/system-prompt/variables/agent-role-variables.ts`:

```typescript
export interface AgentRoleVariables {
  agentName: string;
  agentCorePrompt: string;
}

export function renderAgentRoleVariables(template: string, vars: AgentRoleVariables): string {
  return template
    .replace(/\{\{agentRolePrompt\}\}/g, vars.agentCorePrompt)
    .replace(/\{\{agentName\}\}/g, vars.agentName);
}
```

- [ ] **Step 3: Write tests for the helper**

Create `packages/core/tests/agent-role-variables.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderAgentRoleVariables } from '../src/system-prompt/variables/agent-role-variables.js';

describe('renderAgentRoleVariables', () => {
  it('replaces agentName and agentRolePrompt', () => {
    const result = renderAgentRoleVariables(
      'You are {{agentName}}.\n\n{{agentRolePrompt}}\n\n# Tone',
      { agentName: 'Coder', agentCorePrompt: 'Focus on code.' },
    );
    expect(result).toBe('You are Coder.\n\nFocus on code.\n\n# Tone');
  });

  it('leaves unknown variables intact', () => {
    const result = renderAgentRoleVariables('{{unknown}}', { agentName: 'X', agentCorePrompt: 'Y' });
    expect(result).toBe('{{unknown}}');
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter rem-agent-core test -- packages/core/tests/agent-role-variables.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sdk/system-prompt.ts packages/core/src/system-prompt/variables/agent-role-variables.ts packages/core/tests/agent-role-variables.test.ts
git commit -m "feat(system-prompt): add agent role variables and helper"
```

---

### Task 6: Update System Prompt Templates

**Files:**
- Modify: `packages/core/src/system-prompt/templates/claude-template.md`
- Modify: `packages/core/src/system-prompt/templates/claude-template.ts`
- Modify: `packages/core/src/system-prompt/templates/openai-template.md`
- Modify: `packages/core/src/system-prompt/templates/openai-template.ts`

- [ ] **Step 1: Update `claude-template.md`**

Replace the existing content with:

```markdown
You are {{agentName}}, an agent running inside Rem Agent, powered by Claude.

{{agentRolePrompt}}

# Tone and style
- Be concise, direct, and technically accurate.
- Prioritize truthfulness over validating the user's beliefs; disagree respectfully when necessary.
- Your output is displayed in a terminal/chat UI. Use GitHub-flavored markdown for formatting.
- Only use tools to complete tasks; do not use code comments or shell output as a substitute for user communication.
- Avoid emojis unless the user explicitly asks for them.

# Code conventions
- When referencing specific code, use `file_path:line_number`.
- Do not add comments unless asked.
- Do not create files unless absolutely necessary; prefer editing existing files.
- Follow existing code conventions in the project.

# Tool usage
- Use specialized tools instead of bash commands when a first-class tool exists.
- You can call multiple tools in parallel when they are independent.
- If a tool result is weak or empty, vary your query/path/command before giving up.
```

- [ ] **Step 2: Update `claude-template.ts` to use the helper**

```typescript
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { PromptBuildContext, AgentPromptTemplate } from '../../sdk/system-prompt.js';
import { renderAgentRoleVariables } from '../variables/agent-role-variables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ClaudeAgentPromptTemplate implements AgentPromptTemplate {
  readonly name = 'claude';
  private content?: string;

  async render(ctx: PromptBuildContext): Promise<string> {
    if (this.content === undefined) {
      this.content = await readFile(join(__dirname, 'claude-template.md'), 'utf-8');
    }
    return renderAgentRoleVariables(this.content, {
      agentName: ctx.agentName,
      agentCorePrompt: ctx.agentCorePrompt,
    });
  }
}
```

- [ ] **Step 3: Update `openai-template.md`**

Replace the existing content with:

```markdown
You are {{agentName}}, an agent running inside Rem Agent, powered by an OpenAI model.

{{agentRolePrompt}}

# Tone and style
- Be concise, direct, and to the point. Minimize output tokens while maintaining helpfulness and accuracy.
- Prioritize truthfulness over validating the user's beliefs.
- Your output is displayed in a terminal/chat UI. Use GitHub-flavored markdown for formatting.
- Only use tools to complete tasks; do not use code comments or shell output as a substitute for user communication.

# Code conventions
- When referencing specific code, use `file_path:line_number`.
- Do not add comments unless asked.
- Do not create files unless absolutely necessary; prefer editing existing files.
- Follow existing code conventions in the project.

# Tool usage
- Use specialized tools instead of bash commands when a first-class tool exists.
- Call multiple tools in parallel when they are independent.
- If a tool result is weak or empty, vary your query/path/command before giving up.
```

- [ ] **Step 4: Update `openai-template.ts` similarly**

```typescript
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { PromptBuildContext, AgentPromptTemplate } from '../../sdk/system-prompt.js';
import { renderAgentRoleVariables } from '../variables/agent-role-variables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class OpenAiAgentPromptTemplate implements AgentPromptTemplate {
  readonly name = 'openai';
  private content?: string;

  async render(ctx: PromptBuildContext): Promise<string> {
    if (this.content === undefined) {
      this.content = await readFile(join(__dirname, 'openai-template.md'), 'utf-8');
    }
    return renderAgentRoleVariables(this.content, {
      agentName: ctx.agentName,
      agentCorePrompt: ctx.agentCorePrompt,
    });
  }
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/system-prompt/templates/
git commit -m "feat(system-prompt): split agent identity from role prompt in templates"
```

---

### Task 7: Integrate Agent Resolution into `runAgent`

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Test: `packages/core/tests/run-agent-custom.test.ts`

- [ ] **Step 1: Extend `RunAgentParams` and apply agent resolution**

In `packages/core/src/run-agent.ts`, add to `RunAgentParams`:

```typescript
export interface RunAgentParams {
  // ... existing fields ...
  agent?: string;
}
```

After reading `behavior` and `modelConfig`, add:

```typescript
const agentRole = ctx.configProvider.resolveAgent(params.agent);
const effectiveModel = agentRole.model ?? modelConfig;
```

Update `buildCtx` to use agent fields:

```typescript
const buildCtx: PromptBuildContext = {
  agentName: agentRole.name,
  workspaceRoot,
  readOnly: behavior.readOnly,
  tools,
  skills,
  model: { provider: effectiveModel.provider, model: effectiveModel.model },
  runtime: {
    platform: process.platform,
    nodeVersion: process.version,
    today: new Date().toISOString().split('T')[0],
    cwd: process.cwd(),
  },
  agentCorePrompt: agentRole.corePrompt,
};
```

Update `reason()` call to use `effectiveModel`:

```typescript
reason: () => reason(
  {
    provider: effectiveModel.provider,
    model: effectiveModel.model,
    apiKey: effectiveModel.apiKey,
    baseURL: effectiveModel.baseURL,
    system: systemPrompt,
    messages: msgs,
    tools: toolProviderWithDelegate.getToolSet(),
    signal: params.signal,
    errorHandler,
  },
  (chunk) => trackMessageStart(chunk),
),
```

- [ ] **Step 2: Write the integration test**

Create `packages/core/tests/run-agent-custom.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { AgentContext } from '../src/agent-context.js';
import { AgentState } from '../src/agent-state.js';
import type { PromptBuildContext } from '../src/sdk/system-prompt.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';

vi.mock('../src/reason/reason.js', () => ({
  reason: vi.fn(async () => ({
    [Symbol.asyncIterator]() {
      return { async next() { return { done: true, value: undefined }; } };
    },
  })),
}));

function createMockContext(overrides: Record<string, unknown> = {}) {
  const capturedAssemble = vi.fn(async (_ctx: PromptBuildContext) => 'mock system prompt');
  return {
    configProvider: {
      getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
      getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
      getToolConfig: () => ({}),
      getMcpConfig: () => ({}),
      resolveAgent: (id?: string) => {
        if (id === 'coder') {
          return { id: 'coder', name: 'Code Assistant', corePrompt: 'Focus on code.' };
        }
        if (id === 'coder-with-model') {
          return {
            id: 'coder-with-model',
            name: 'Code Assistant',
            corePrompt: 'Focus on code.',
            model: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'sk-anthropic', baseURL: undefined },
          };
        }
        return { id: 'default', name: 'test', corePrompt: 'Default prompt.' };
      },
    },
    sessionProvider: { load: async () => null, save: async () => {}, addMessage: () => ({} as any), appendContent: () => {} },
    toolProvider: { getToolSet: () => ({}), register: () => {} },
    contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
    skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
    budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 1, consecutiveErrors: 0, atRisk: false }) },
    compressor: { shouldCompress: () => false, compress: async (msgs: unknown[]) => msgs },
    errorHandler: { classify: () => 'unknown', isRetryable: () => false },
    titleProvider: { generateTitle: async () => undefined },
    mcpManager: { connectAll: async () => [], closeAll: async () => {} },
    fileMutationQueue: createFileMutationQueue(),
    systemPromptAssembler: { assemble: capturedAssemble },
    toolComposer: {
      compose: () => ({
        getToolSet: () => ({}),
        execute: async () => [],
        register: () => {},
        isDangerous: () => false,
      }),
    },
    mcpProviders: [],
    loopStrategy: {
      run: async (loopCtx: any) => {
        await loopCtx.reason();
        return {
          content: 'hello back',
          newMessages: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    },
    ...overrides,
  } as unknown as AgentContext;
}

describe('runAgent custom agent', () => {
  it('uses custom agent corePrompt and falls back to default model', async () => {
    const { runAgent } = await import('../src/run-agent.js');
    const { reason } = await import('../src/reason/reason.js');

    const ctx = createMockContext();
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx,
      agentState: new AgentState(),
      agent: 'coder',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const assembleCall = (ctx.systemPromptAssembler.assemble as any).mock.calls[0][0];
    expect(assembleCall.agentName).toBe('Code Assistant');
    expect(assembleCall.agentCorePrompt).toBe('Focus on code.');

    const reasonCall = (reason as any).mock.calls[0][0];
    expect(reasonCall.provider).toBe('openai');
    expect(reasonCall.model).toBe('gpt-4o-mini');
    expect(reasonCall.system).toBe('mock system prompt');
  });

  it('uses custom agent model override', async () => {
    const { runAgent } = await import('../src/run-agent.js');
    const { reason } = await import('../src/reason/reason.js');

    const ctx = createMockContext();
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx,
      agentState: new AgentState(),
      agent: 'coder-with-model',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const reasonCall = (reason as any).mock.calls[0][0];
    expect(reasonCall.provider).toBe('anthropic');
    expect(reasonCall.model).toBe('claude-3-5-sonnet-20241022');
    expect(reasonCall.apiKey).toBe('sk-anthropic');
  });

  it('falls back to default when agent is unknown', async () => {
    const { runAgent } = await import('../src/run-agent.js');
    const ctx = createMockContext();
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx,
      agentState: new AgentState(),
      agent: 'unknown',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const assembleCall = (ctx.systemPromptAssembler.assemble as any).mock.calls[0][0];
    expect(assembleCall.agentName).toBe('test');
    expect(assembleCall.agentCorePrompt).toBe('Default prompt.');
  });
});
```

- [ ] **Step 3: Run the integration test**

```bash
pnpm --filter rem-agent-core test -- packages/core/tests/run-agent-custom.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/run-agent.ts packages/core/tests/run-agent-custom.test.ts
git commit -m "feat(run-agent): apply custom agent role and model override at runtime"
```

---

### Task 8: Typecheck and Run Full Test Suite

**Files:**
- All modified files

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 2: Run core tests**

```bash
pnpm --filter rem-agent-core test
```

Expected: all tests pass

- [ ] **Step 3: Commit if any fixes were needed**

If no fixes needed, skip. If fixes made, commit with `git commit -m "fix: address typecheck/test issues"`.

---

### Task 9: Update Documentation

**Files:**
- Modify: `packages/core/README.md`
- Modify: `docs/superpowers/specs/2026-07-13-custom-agent-config-design.md` status

- [ ] **Step 1: Add custom agent section to `packages/core/README.md`**

Add a short section under the existing config or quick-start area:

```markdown
## Custom Agents

You can define multiple agents in `rem-agent.config.json`:

```json
{
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "corePrompt": "You focus on writing clean, concise code and follow existing conventions.",
      "model": { "provider": "openai", "model": "gpt-4o" }
    }
  }
}
```

Switch at runtime:

```typescript
runAgent({ ..., agent: 'coder' });
```

If the agent is not found or no `agent` is provided, the built-in default agent is used.
```

- [ ] **Step 2: Update spec status**

In `docs/superpowers/specs/2026-07-13-custom-agent-config-design.md`, change the status line to:

```markdown
> 状态：已实现
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/README.md docs/superpowers/specs/2026-07-13-custom-agent-config-design.md
git commit -m "docs: document custom agent config and update spec status"
```

---

## Self-Review Checklist

- [ ] Spec coverage: every section of the design doc has a corresponding task or sub-step.
- [ ] Placeholder scan: no "TBD", "TODO", or vague instructions remain.
- [ ] Type consistency: `CustomAgentConfig`, `ResolvedAgentRole`, `resolveAgent`, `PromptBuildContext`, and `RunAgentParams` use the same names across all tasks.
- [ ] Test coverage: unit tests for resolver, variables, parser/merger; integration test for `runAgent`.
- [ ] No unrelated refactoring: tasks stay focused on custom agent config.

---

## Plan Complete

**Plan saved to:** `docs/superpowers/plans/2026-07-13-custom-agent-config.md`

**Execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach do you prefer?
