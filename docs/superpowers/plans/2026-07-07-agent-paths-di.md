# AgentPaths 路径集中管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将散落在各 Provider 中的文件/目录路径约定集中到 `AgentPaths` 接口，通过依赖注入替代硬编码。

**Architecture:** 扩展 `config/paths.ts` 为 `AgentPaths` 接口 + `createDefaultAgentPaths` 工厂函数。创建 Agent 时构造 paths 实例，注入到 `DefaultConfigProvider`、`FileSkillProvider`、`debug-log` 等模块。文件级命名（`.jsonl`、`SKILL.md`）保留在各 Provider 内不变。

**Tech Stack:** TypeScript, Node.js

## Global Constraints

- 只改目录级路径，文件后缀/命名不收拢（如 `.jsonl`、`SKILL.md` 归 Provider 私有）
- 构建配置路径（tsconfig、vitest、pnpm-workspace）不在本次范围
- `resolveTilde` 保留为独立导出函数不变

---

## File Map

| 文件 | 操作 | 职责 |
|---|---|---|
| `packages/core/src/config/paths.ts` | 重写 | `AgentPaths` 接口 + `createDefaultAgentPaths` |
| `packages/core/src/plugins/config/default/config-loader.ts` | 修改 | `resolveConfigPath` 接收 `paths: AgentPaths` |
| `packages/core/src/plugins/config/default/config-merger.ts` | 修改 | `applyBehaviorDefaults` 接收 `sessionsDir` 参数 |
| `packages/core/src/plugins/config/default/index.ts` | 修改 | constructor 接收 `paths: AgentPaths`，透传 |
| `packages/core/src/shared/debug-log.ts` | 修改 | 暴露 `configureDebugLog`，去掉内部 env 读取 |
| `packages/core/src/plugins/skill/file/index.ts` | 修改 | constructor 接收 `paths: AgentPaths`，删除内部 resolve 函数 |
| `packages/core/src/agent-factory.ts` | 修改 | 创建 `paths`，注入到各 Provider |
| `packages/core/tests/setup.ts` | 修改 | 不再设置 `REM_AGENT_HOME` 环境变量 |
| `packages/core/tests/config/paths.test.ts` | 重写 | 针对新 API 的测试 |

---

### Task 1: 重写 `config/paths.ts` — AgentPaths 接口与默认实现

**Files:**
- Modify: `packages/core/src/config/paths.ts`

**Interfaces:**
- Produces: `AgentPaths` 接口、`CreateAgentPathsOptions` 接口、`createDefaultAgentPaths(opts?)` 函数、`resolveTilde(rawPath)` 函数

- [ ] **Step 1: 写测试**

```typescript
// packages/core/tests/config/paths.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createDefaultAgentPaths, resolveTilde } from '../../src/config/paths.js';
import type { AgentPaths } from '../../src/config/paths.js';

describe('createDefaultAgentPaths', () => {
  it('should create paths with defaults', () => {
    vi.stubEnv('REM_AGENT_HOME', '');
    vi.stubEnv('REM_AGENT_DIR', '');
    const paths = createDefaultAgentPaths();
    expect(paths.agentDir).toContain('.rem-agent');
    expect(paths.homeSkillsDir).toContain('.agents/skills');
    expect(paths.sessionsDir).toContain('.rem-agent/sessions');
  });

  it('should respect REM_AGENT_HOME', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_HOME: '/custom/home' } });
    expect(paths.agentDir).toBe('/custom/home');
    expect(paths.sessionsDir).toBe('/custom/home/sessions');
  });

  it('should allow overriding agentDir', () => {
    const paths = createDefaultAgentPaths({ agentDir: '/tmp/test-agent' });
    expect(paths.agentDir).toBe('/tmp/test-agent');
    expect(paths.sessionsDir).toBe('/tmp/test-agent/sessions');
  });

  it('should allow overriding homeSkillsDir and sessionsDir', () => {
    const paths = createDefaultAgentPaths({
      homeSkillsDir: '/custom/skills',
      sessionsDir: '/custom/sessions',
    });
    expect(paths.homeSkillsDir).toBe('/custom/skills');
    expect(paths.sessionsDir).toBe('/custom/sessions');
  });

  it('should resolve ~ in REM_AGENT_HOME', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_HOME: '~/my-agent' } });
    expect(paths.agentDir).not.toContain('~');
    expect(paths.agentDir).toContain('my-agent');
  });

  it('workspaceSkillsDir should return correct path', () => {
    const paths = createDefaultAgentPaths({ agentDir: '/tmp/a' });
    expect(paths.workspaceSkillsDir('/root')).toBe('/root/.agents/skills');
  });

  it('configCandidates should return candidates in priority order', () => {
    const paths = createDefaultAgentPaths({ agentDir: '/tmp/a' });
    const candidates = paths.configCandidates('/cwd');
    expect(candidates).toHaveLength(6);
    expect(candidates[0]).toBe('/cwd/rem-agent.config.json');
    expect(candidates[1]).toBe('/cwd/rem-agent.config.yaml');
    expect(candidates[2]).toBe('/cwd/rem-agent.config.yml');
    expect(candidates[3]).toBe('/tmp/a/config.json');
    expect(candidates[4]).toBe('/tmp/a/config.yaml');
    expect(candidates[5]).toBe('/tmp/a/config.yml');
  });

  it('debugLogFile should be null by default', () => {
    const paths = createDefaultAgentPaths({ env: {} });
    expect(paths.debugLogFile).toBeNull();
  });

  it('debugLogFile should return REM_AGENT_DEBUG_FILE if set', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_DEBUG_FILE: '/tmp/debug.log' } });
    expect(paths.debugLogFile).toBe('/tmp/debug.log');
  });

  it('debugLogFile should return /tmp/rem-agent-debug.log when REM_AGENT_DEBUG=1', () => {
    const paths = createDefaultAgentPaths({ env: { REM_AGENT_DEBUG: '1', REM_AGENT_DEBUG_FILE: undefined } });
    expect(paths.debugLogFile).toBe('/tmp/rem-agent-debug.log');
  });
});

describe('resolveTilde', () => {
  it('should expand leading tilde', () => {
    const result = resolveTilde('~/foo');
    expect(result).not.toContain('~');
    expect(result).toContain('foo');
  });

  it('should not modify absolute paths', () => {
    expect(resolveTilde('/absolute/foo')).toBe('/absolute/foo');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test -- --run tests/config/paths.test.ts
```
Expected: FAIL—`createDefaultAgentPaths` not defined.

- [ ] **Step 3: 实现 `config/paths.ts`**

```typescript
import { homedir } from 'os';
import { join } from 'path';

// ─── 类型 ────────────────────────────────────────────

export interface AgentPaths {
  /** Agent 数据根目录 */
  readonly agentDir: string;

  /** 用户级技能目录，默认 ~/.agents/skills */
  readonly homeSkillsDir: string;

  /** 项目级技能目录，默认 <workspaceRoot>/.agents/skills */
  workspaceSkillsDir(workspaceRoot: string): string;

  /** 配置文件候选列表（优先级从高到低） */
  configCandidates(cwd: string): string[];

  /** 会话存储目录 */
  readonly sessionsDir: string;

  /** 调试日志路径，null 表示禁用 */
  readonly debugLogFile: string | null;
}

export interface CreateAgentPathsOptions {
  agentDir?: string;
  homeSkillsDir?: string;
  sessionsDir?: string;
  env?: Partial<NodeJS.ProcessEnv>;
}

// ─── 默认实现 ────────────────────────────────────────

export function createDefaultAgentPaths(opts: CreateAgentPathsOptions = {}): AgentPaths {
  const env = opts.env ?? process.env;

  const agentDir = opts.agentDir ?? resolveAgentDir(env);
  const homeSkillsDir = opts.homeSkillsDir ?? join(homedir(), '.agents', 'skills');
  const sessionsDir = opts.sessionsDir ?? join(agentDir, 'sessions');
  const debugLogFile = resolveDebugLogFile(env);

  return {
    agentDir,
    homeSkillsDir,

    workspaceSkillsDir(workspaceRoot: string) {
      return join(workspaceRoot, '.agents', 'skills');
    },

    configCandidates(cwd: string) {
      return [
        join(cwd, 'rem-agent.config.json'),
        join(cwd, 'rem-agent.config.yaml'),
        join(cwd, 'rem-agent.config.yml'),
        join(agentDir, 'config.json'),
        join(agentDir, 'config.yaml'),
        join(agentDir, 'config.yml'),
      ];
    },

    sessionsDir,
    debugLogFile,
  };
}

// ─── 工具函数 ────────────────────────────────────────

/** 展开路径中的 ~ 为 home 目录，供 security 等模块使用 */
export function resolveTilde(rawPath: string): string {
  if (rawPath.startsWith('~')) {
    return join(homedir(), rawPath.slice(1));
  }
  return rawPath;
}

// ─── 内部 helpers ────────────────────────────────────

function resolveAgentDir(env: Partial<NodeJS.ProcessEnv>): string {
  const raw = env.REM_AGENT_HOME || env.REM_AGENT_DIR;
  if (raw) {
    return resolveTilde(raw);
  }
  if (env.NODE_ENV === 'development') {
    return join(process.cwd(), '.rem-agent');
  }
  return join(homedir(), '.rem-agent');
}

function resolveDebugLogFile(env: Partial<NodeJS.ProcessEnv>): string | null {
  if (env.REM_AGENT_DEBUG_FILE) {
    return env.REM_AGENT_DEBUG_FILE;
  }
  if (env.REM_AGENT_DEBUG === '1') {
    return '/tmp/rem-agent-debug.log';
  }
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test -- --run tests/config/paths.test.ts
```
Expected: PASS (12 tests)

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/config/paths.ts packages/core/tests/config/paths.test.ts
git commit -m "refactor(core): replace path functions with AgentPaths interface and createDefaultAgentPaths

Introduce AgentPaths interface to centralize directory-level path conventions.
createDefaultAgentPaths factory replaces getRemAgentDir/getDefaultSkillsDir/getDefaultSessionsDir.
Keep resolveTilde as standalone utility function.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 修改 `config-loader.ts` — 接收 `paths` 参数

**Files:**
- Modify: `packages/core/src/plugins/config/default/config-loader.ts`

**Interfaces:**
- Consumes: `AgentPaths` from `config/paths.js`
- Produces: `resolveConfigPath(explicitPath: string | undefined, cwd: string, paths: AgentPaths): string | undefined`

- [ ] **Step 1: 修改 `resolveConfigPath` 签名**

```typescript
// packages/core/src/plugins/config/default/config-loader.ts
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ConfigFileData } from './index.js';
import { resolveTilde } from '../../../config/paths.js';
import type { AgentPaths } from '../../../config/paths.js';

export async function loadConfigFile(path: string): Promise<ConfigFileData> {
  const resolved = resolveTilde(path);
  const content = await readFile(resolved, 'utf8');
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(content) as ConfigFileData;
  }
  const { parse } = await import('yaml');
  return parse(content) as ConfigFileData;
}

export function resolveConfigPath(
  explicitPath: string | undefined,
  cwd: string,
  paths: AgentPaths,
): string | undefined {
  if (explicitPath) return resolveTilde(explicitPath);
  const candidates = paths.configCandidates(cwd);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
```

关键变更：删除 `getRemAgentDir` 的 import，`resolveConfigPath` 加第三个参数 `paths: AgentPaths`，`candidates` 从 `paths.configCandidates(cwd)` 获取。

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/plugins/config/default/config-loader.ts
git commit -m "refactor(core): inject AgentPaths into config-loader

resolveConfigPath now takes paths parameter instead of calling getRemAgentDir directly.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 修改 `config-merger.ts` — `applyBehaviorDefaults` 接收 `sessionsDir`

**Files:**
- Modify: `packages/core/src/plugins/config/default/config-merger.ts`

**Interfaces:**
- Produces: `applyBehaviorDefaults(config: AgentConfig, sessionsDir: string): Required<AgentBehaviorConfig>`

- [ ] **Step 1: 修改 `applyBehaviorDefaults`**

```typescript
// packages/core/src/plugins/config/default/config-merger.ts
import type { AgentConfig, AgentBehaviorConfig } from '../../../sdk/config-provider.js';
import { pickToolPolicy, pickModels, pickModelConfig, pickMcpConfig } from './config-parser.js';

export function mergeFileConfig(base: AgentConfig, file: Record<string, unknown>): AgentConfig {
  const merged: AgentConfig = { ...base };
  if (typeof file.name === 'string') merged.name = file.name;
  if (typeof file.maxTurns === 'number') merged.maxTurns = file.maxTurns;
  if (typeof file.workspaceRoot === 'string') merged.workspaceRoot = file.workspaceRoot;
  if (typeof file.readOnly === 'boolean') merged.readOnly = file.readOnly;
  if (typeof file.autoApproveDangerous === 'boolean') merged.autoApproveDangerous = file.autoApproveDangerous;
  if (typeof file.sessionsDir === 'string') merged.sessionsDir = file.sessionsDir;
  const toolPolicy = pickToolPolicy(file.toolPolicy);
  if (toolPolicy) merged.toolPolicy = toolPolicy;
  const models = pickModels(file.models);
  if (models) merged.models = models;
  const singleModel = pickModelConfig(file.model);
  if (singleModel) merged.model = singleModel;
  if (typeof file.activeModel === 'string') merged.activeModel = file.activeModel;
  const mcpServers = pickMcpConfig(file.mcpServers);
  if (mcpServers) merged.mcpServers = mcpServers;
  return merged;
}

export function mergeEnvConfig(base: AgentConfig, env: NodeJS.ProcessEnv): AgentConfig {
  const merged: AgentConfig = { ...base };
  if (env.REM_AGENT_NAME) merged.name = env.REM_AGENT_NAME;
  if (env.REM_AGENT_MAX_TURNS) merged.maxTurns = parseInt(env.REM_AGENT_MAX_TURNS, 10);
  if (env.REM_AGENT_WORKSPACE_ROOT) merged.workspaceRoot = env.REM_AGENT_WORKSPACE_ROOT;
  if (env.REM_AGENT_READ_ONLY) merged.readOnly = env.REM_AGENT_READ_ONLY === 'true';
  if (env.REM_AGENT_AUTO_APPROVE_DANGEROUS) merged.autoApproveDangerous = env.REM_AGENT_AUTO_APPROVE_DANGEROUS === 'true';
  if (env.REM_AGENT_SESSIONS_DIR) merged.sessionsDir = env.REM_AGENT_SESSIONS_DIR;
  if (env.REM_AGENT_ACTIVE_MODEL) merged.activeModel = env.REM_AGENT_ACTIVE_MODEL;
  return merged;
}

export function applyBehaviorDefaults(
  config: AgentConfig,
  sessionsDir: string,
): Required<AgentBehaviorConfig> {
  return {
    name: config.name ?? 'Rem Agent',
    maxTurns: config.maxTurns ?? 60,
    workspaceRoot: config.workspaceRoot ?? process.cwd(),
    readOnly: config.readOnly ?? false,
    autoApproveDangerous: config.autoApproveDangerous ?? false,
    sessionsDir: config.sessionsDir ?? sessionsDir,
  };
}
```

关键变更：删掉 `import { getDefaultSessionsDir } from '../../../config/paths.js'`，`applyBehaviorDefaults` 加第二个参数 `sessionsDir: string`，默认值从 `getDefaultSessionsDir()` 改为参数传入的 `sessionsDir`。

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/plugins/config/default/config-merger.ts
git commit -m "refactor(core): inject sessionsDir into applyBehaviorDefaults

Remove direct import of getDefaultSessionsDir, accept sessionsDir as parameter.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 修改 `DefaultConfigProvider` — 接收并透传 `paths`

**Files:**
- Modify: `packages/core/src/plugins/config/default/index.ts`

**Interfaces:**
- Consumes: `AgentPaths` from `config/paths.js`
- Produces: `DefaultConfigProviderOptions` 新增 `paths` 字段

- [ ] **Step 1: 修改 `DefaultConfigProvider`**

```typescript
// packages/core/src/plugins/config/default/index.ts (关键变更部分)
import type { AgentPaths } from '../../../config/paths.js';

export interface DefaultConfigProviderOptions {
  cwd?: string;
  configPath?: string;
  overrides?: AgentConfig;
  env?: NodeJS.ProcessEnv;
  paths?: AgentPaths;
}

export class DefaultConfigProvider implements ConfigProvider {
  private raw?: AgentConfig;
  private env: NodeJS.ProcessEnv;
  private paths: AgentPaths;

  constructor(private options: DefaultConfigProviderOptions = {}) {
    this.env = options.env ?? process.env;
    // 延迟加载 paths：优先用注入的，没有则创建默认
    this.paths = options.paths ?? (() => {
      const { createDefaultAgentPaths } = require('../../../config/paths.js');
      return createDefaultAgentPaths({ env: this.env });
    })();
  }

  async init(): Promise<void> {
    const cwd = this.options.cwd ?? process.cwd();
    let config: AgentConfig = {};

    const configPath = resolveConfigPath(this.options.configPath, cwd, this.paths);
    if (configPath) {
      const file = await loadConfigFile(configPath);
      config = mergeFileConfig(config, file);
    }

    config = mergeEnvConfig(config, this.env);

    if (this.options.overrides) {
      config = { ...config, ...this.options.overrides };
      const overridePolicy = pickToolPolicy(this.options.overrides.toolPolicy);
      if (overridePolicy) config.toolPolicy = overridePolicy;
      if (this.options.overrides.model) config.model = this.options.overrides.model;
      if (this.options.overrides.models) config.models = this.options.overrides.models;
      if (this.options.overrides.activeModel) config.activeModel = this.options.overrides.activeModel;
    }

    this.raw = config;
  }

  getBehaviorConfig(): Required<AgentBehaviorConfig> {
    return applyBehaviorDefaults(this.getRawConfig(), this.paths.sessionsDir);
  }

  // ... 其余方法不变
}
```

关键变更：
1. `DefaultConfigProviderOptions` 新增 `paths?: AgentPaths`
2. constructor 中存储 `this.paths`（有注入用注入，无则用 `createDefaultAgentPaths` 作为兼容）
3. `init()` 中 `resolveConfigPath` 调用传入 `this.paths`
4. `getBehaviorConfig()` 中 `applyBehaviorDefaults` 传入 `this.paths.sessionsDir`

**注意**：构造函数中的 fallback 使用了同步的 `require` 方式，但 ESM 模块下不允许。实际上应该用懒初始化的模式。让我调整：

```typescript
constructor(private options: DefaultConfigProviderOptions = {}) {
  this.env = options.env ?? process.env;
  this.paths = options.paths /* 先这样放着，init 时检查 */;
}

async init(): Promise<void> {
  if (!this.paths) {
    const { createDefaultAgentPaths } = await import('../../../config/paths.js');
    this.paths = createDefaultAgentPaths({ env: this.env });
  }
  // ... 其余逻辑
}
```

- [ ] **Step 2: 运行现有的 config provider 测试确认兼容**

```bash
pnpm --filter rem-agent-core test -- --run tests/default-config-provider.test.ts
```
Expected: PASS（因为 `paths` optional，不传时在 `init` 中懒创建默认值）

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/plugins/config/default/index.ts
git commit -m "refactor(core): inject AgentPaths into DefaultConfigProvider

DefaultConfigProviderOptions now accepts optional paths. When not provided,
paths is lazily created from createDefaultAgentPaths in init() for backward compat.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 修改 `debug-log.ts` — 暴露 `configureDebugLog`

**Files:**
- Modify: `packages/core/src/shared/debug-log.ts`

**Interfaces:**
- Produces: `configureDebugLog(file: string | null): void`

- [ ] **Step 1: 修改 `debug-log.ts`**

```typescript
import { appendFileSync } from 'fs';

let debugFile: string | null = null;

/**
 * 配置调试日志输出文件。传入 null 禁用。
 * 应在应用初始化时调用，替代原来的环境变量读取。
 */
export function configureDebugLog(file: string | null): void {
  debugFile = file;
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

export function debugLog(tag: string, message: string): void {
  if (!debugFile) return;
  const line = `[${timestamp()}] [${tag}] ${message}\n`;
  try {
    appendFileSync(debugFile, line);
  } catch {
    // silently ignore write failures
  }
}

/**
 * Check whether debug logging is currently enabled.
 */
export function isDebugEnabled(): boolean {
  return debugFile !== null;
}
```

关键变更：删除 `resolveDebugFile()` 函数和对 `REM_AGENT_DEBUG` / `REM_AGENT_DEBUG_FILE` 环境变量的直接读取。新增 `configureDebugLog(file: string | null)` 替代。

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/shared/debug-log.ts
git commit -m "refactor(core): replace env-based debug log resolution with configureDebugLog

Remove resolveDebugFile() which read REM_AGENT_DEBUG env vars directly.
Expose configureDebugLog() for explicit injection via AgentPaths.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 修改 `FileSkillProvider` — 接收 `paths` 参数

**Files:**
- Modify: `packages/core/src/plugins/skill/file/index.ts`

**Interfaces:**
- Consumes: `AgentPaths` from `config/paths.js`
- Produces: `FileSkillProvider` constructor 第二个参数改为 `paths: AgentPaths`

- [ ] **Step 1: 修改 `FileSkillProvider`**

```typescript
// packages/core/src/plugins/skill/file/index.ts (关键变更部分)
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import type { Skill, SkillProvider } from '../../../sdk/skill-provider.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import type { AgentPaths } from '../../../config/paths.js';
import { DefaultSkillCatalog } from '../default-catalog.js';
import { parseSkillMarkdown } from '../../../utils/skill-parser.js';

const SKILLS_DIR_NAME = 'skills';

export class FileSkillProvider implements SkillProvider {
  private homeSkillsDir: string;
  private workspaceSkillsDir: (workspaceRoot: string) => string;
  private catalog = new DefaultSkillCatalog();

  constructor(configProvider: ConfigProvider, paths: AgentPaths) {
    this.homeSkillsDir = paths.homeSkillsDir;
    this.workspaceSkillsDir = (workspaceRoot: string) => paths.workspaceSkillsDir(workspaceRoot);
  }

  // ... loadSkills, loadSkillsFromDir, readSkillRaw, readSkillRawFromDir 等方法不变 ...
  // 注意：readSkillRawFromDir 中的 SKILL.md 文件名保留为私有常量不变
}

// 删除原来的 resolveHomeSkillsDir() 和 resolveWorkspaceSkillsDir() 两个函数
```

关键变更：
1. 删除 `import { homedir } from 'os'`（不再需要）
2. 删除文件底部的 `resolveHomeSkillsDir()` 和 `resolveWorkspaceSkillsDir()` 函数
3. 删除顶部的 `AGENT_DIR_NAME` 常量
4. `constructor(configProvider, paths: AgentPaths)` 替代原来的 `constructor(configProvider, homeSkillsDirOverride?)`
5. `this.homeSkillsDir = paths.homeSkillsDir`
6. `this.workspaceSkillsDir` 改为包装函数
7. `SKILLS_DIR_NAME` 常量保留（文件级命名，归 Provider 管理）

- [ ] **Step 2: 运行现有的 skill provider 测试**

```bash
pnpm --filter rem-agent-core test -- --run tests/file-skill-provider.test.ts
```
Expected: 测试需要更新（constructor 签名变了）。先跑一下看看哪些测试需要改。

- [ ] **Step 3: 更新测试并确认通过**

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/plugins/skill/file/index.ts packages/core/tests/file-skill-provider.test.ts
git commit -m "refactor(core): inject AgentPaths into FileSkillProvider

Replace internal resolveHomeSkillsDir/resolveWorkspaceSkillsDir with paths parameter.
File-level naming (SKILL.md) stays as private constant.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 修改 `agent-factory.ts` — 创建 paths 并注入

**Files:**
- Modify: `packages/core/src/agent-factory.ts`

**Interfaces:**
- Consumes: `createDefaultAgentPaths` from `config/paths.js`

- [ ] **Step 1: 修改 `createAgentFromEnv`**

```typescript
import { createDefaultAgentPaths } from './config/paths.js';
import { configureDebugLog } from './shared/debug-log.js';
// ... 其余 import 不变

export interface CreateAgentOptions {
  name?: string;
  configPath?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  provider?: string;
  model?: string;
}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentContext> {
  registerBuiltInProviders();

  // 0. 创建 AgentPaths（集中管理所有路径约定）
  const paths = createDefaultAgentPaths();

  // 0.1 配置调试日志
  configureDebugLog(paths.debugLogFile);

  // 1. ConfigProvider（注入 paths）
  const configProvider = new DefaultConfigProvider({
    paths,
    configPath: options?.configPath,
    overrides: {
      name: options?.name,
      maxTurns: options?.maxTurns,
      workspaceRoot: options?.workspaceRoot,
      readOnly: options?.readOnly,
      autoApproveDangerous: options?.autoApproveDangerous,
      ...(options?.provider ? { model: { provider: options.provider, model: options.model ?? '' } } : {}),
    },
  });
  await configProvider.init();

  // 2. 显式创建所有 Provider
  const sessionProvider = new InMemorySessionProvider();
  const agentLiveProvider = new InMemoryAgentLiveProvider();
  const toolProvider = createFileSystemTools(configProvider);
  const contextProvider = new SimpleContextProvider(configProvider);
  const skillProvider = new FileSkillProvider(configProvider, paths);  // 注入 paths
  const budgetPolicy = new FixedBudgetPolicy(configProvider);
  const compressor = new NoOpCompressor();
  const errorHandler = new SimpleErrorHandler();
  const titleProvider = new LLMTitleProvider(configProvider);
  const loopStrategy = new ReactLoop();

  // 3. MCP
  const mcpConfig = configProvider.getMcpConfig();
  const mcpManager = new McpConnectionManager();
  const mcpProviders = await mcpManager.connectAll(mcpConfig);
  const effectiveToolProvider = mcpProviders.length > 0
    ? new CompositeToolProvider(toolProvider, mcpProviders)
    : toolProvider;

  // 4. read_skill
  effectiveToolProvider.register(
    createReadSkillToolDefinition(),
    createReadSkillToolExecutor(() => skillProvider),
  );

  return {
    configProvider,
    sessionProvider,
    agentLiveProvider,
    toolProvider: effectiveToolProvider,
    contextProvider,
    skillProvider,
    budgetPolicy,
    compressor,
    errorHandler,
    titleProvider,
    loopStrategy,
    mcpManager,
  };
}
```

关键变更：
1. 新增 `import { createDefaultAgentPaths } from './config/paths.js'`
2. 新增 `import { configureDebugLog } from './shared/debug-log.js'`
3. 在函数开头创建 `const paths = createDefaultAgentPaths()`
4. `configureDebugLog(paths.debugLogFile)`
5. `DefaultConfigProvider` 传入 `paths`
6. `FileSkillProvider` 传入 `paths`

- [ ] **Step 2: 确认编译通过**

```bash
pnpm --filter rem-agent-core typecheck
```
Expected: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/agent-factory.ts
git commit -m "refactor(core): create and inject AgentPaths in createAgentFromEnv

AgentPaths is constructed once and injected into DefaultConfigProvider,
FileSkillProvider, and debug-log, replacing scattered path resolution.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 清理测试与旧代码

**Files:**
- Modify: `packages/core/tests/setup.ts`
- Modify: `packages/core/tests/default-config-provider.test.ts`（如需）
- Modify: `packages/core/tests/file-skill-provider.test.ts`（如需）

- [ ] **Step 1: 修改 `tests/setup.ts`**

```typescript
// 删除原来的: process.env.REM_AGENT_HOME = '/tmp/rem-agent-test';
// 新内容为空文件（或只保留注释说明测试中通过 createDefaultAgentPaths({ agentDir: ... }) 自定义路径）
```

- [ ] **Step 2: 检查并更新 `default-config-provider.test.ts`**

该测试通过 `process.env.REM_AGENT_HOME = tempDir` 来控制 config 读取路径。现在 `DefaultConfigProvider` 不传 `paths` 时有 fallback（从 `REM_AGENT_HOME` 环境变量 lazily 创建）。现有测试应该仍然能通过，但我们需要确认。

```bash
pnpm --filter rem-agent-core test -- --run tests/default-config-provider.test.ts
```
Expected: 确认测试是否通过。如果 `DefaultConfigProvider` 的 fallback 逻辑正确（从 env 创建 paths），测试应该通过。

- [ ] **Step 3: 更新 `file-skill-provider.test.ts`**

```bash
pnpm --filter rem-agent-core test -- --run tests/file-skill-provider.test.ts
```
根据 constructor 签名变更，更新测试中创建 `FileSkillProvider` 的地方。
确保测试通过。

- [ ] **Step 4: 运行全部测试**

```bash
pnpm typecheck && pnpm test
```
Expected: 所有测试通过，类型检查通过。

- [ ] **Step 5: 提交**

```bash
git add packages/core/tests/
git commit -m "test(core): update tests for AgentPaths DI

Remove hardcoded REM_AGENT_HOME from test setup, update provider constructors
in tests to pass AgentPaths where needed.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 清理旧导出（可选）

**Files:**
- Modify: `packages/core/src/index.ts`

`index.ts` 中 `export * from './config/paths.js'` 现在导出的是 `AgentPaths`、`CreateAgentPathsOptions`、`createDefaultAgentPaths`、`resolveTilde`。旧的 `getRemAgentDir`、`getDefaultSkillsDir`、`getDefaultSessionsDir` 已删除。

确认没有外部消费者使用旧函数：

```bash
grep -r "getRemAgentDir\|getDefaultSkillsDir\|getDefaultSessionsDir" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v ".test.ts"
```

如果无结果，则无需额外处理。`index.ts` 不需要修改。

---

### Task 10: 最终验证

- [ ] **Step 1: 类型检查**

```bash
pnpm typecheck
```

- [ ] **Step 2: 全部测试**

```bash
pnpm test
```

- [ ] **Step 3: 确认 git 状态 clean，提交最后的遗漏**

```bash
git status
git add -A
git diff --cached --stat
```
