# Core 模块目录治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `packages/core/src` 从按技术概念混合堆放的 160 个文件，重组为按业务能力分区的目录结构（agent/ assembly/ runtime/ session/ tools/ security/ capabilities/ infrastructure/），拆分 4 个超限文件，收紧公共出口，并用结构检查脚本固化依赖规则。

**Architecture:** 纯迁移 + 机械拆分，不改变任何运行行为。核心手法是：一个通用的 import 重写 codemod（按 mapping JSON 重写全部相对导入）+ 每批次一个 mapping 文件 + 每批次 typecheck/test 验证。外部包（bridge/routes/ui/web）只通过根 `index.ts` 和 3 个 package.json subpath 消费 core，只要导出符号名不变、subpath key 不变，外部零改动。`delegate-task-v2` 的符号改名通过 `compat.ts` 保留旧别名。

**Tech Stack:** TypeScript (NodeNext)、pnpm workspaces、vitest、better-sqlite3。

**Spec:** `docs/superpowers/specs/2026-07-30-core-module-governance-design.md`

---

## 背景知识（执行者必读）

- 仓库是 pnpm monorepo。所有验证命令在仓库根目录执行。
- core 的 tsconfig 是 NodeNext，**所有相对导入必须带 `.js` 扩展名**。
- core 内部测试（`packages/core/tests/`）混用两种导入：`../src/xxx.js` 相对路径（codemod 会处理）和 `rem-agent-core` 包名 self-import（走根 `vitest.config.ts` alias → `src/index.ts`，不受移动影响）。
- 外部包对 core 的消费只有两条通路：
  1. 包名 `rem-agent-core`（根 index.ts）——导出**符号名**不变即可。
  2. 三个 subpath：`rem-agent-core/token-usage`、`rem-agent-core/llm/context-window`（ui 的 token-stats.tsx 使用）、`rem-agent-core/stream/event-aggregators`（无消费者但已发布）。subpath **key 不变**、只改 target 路径即可。
- 根 `vitest.config.ts` 第 16-18 行有三条 alias 绑死上述物理路径，文件移动后必须同步。
- 规范红线（来自 module-separation-convention）：实现文件绝对上限 200 行、入口/聚合文件绝对上限 120 行。

## 规格未明确、本计划拍板的归属决策

规格迁移映射表未覆盖以下文件，按依赖规则就近安置：

| 文件 | 目标 | 理由 |
|---|---|---|
| `bus-events.ts`、`broadcast-bus.ts` | `agent/` | BusEvent/SessionActivity 是 Agent/Session 活动事件领域 |
| `stream/event-aggregators.ts` | `agent/event-aggregators.ts` | 聚合 AgentStreamEvent（agent/types 领域） |
| `security/exec-classifier.ts` | `security/permissions/` | 命令风险分级服务于权限评估 |
| `types/bash-parser.d.ts` | `security/permissions/` | 唯一消费者是 exec-classifier |
| `agent-resolver.ts` | `plugins/config/default/agent-resolver.ts` | 唯一消费者是 DefaultConfigProvider；放 assembly 会违反"plugins 不得导入 assembly" |
| `utils/skill-parser.ts` | `plugins/skill/skill-parser.ts` | 唯一消费者是 FileSkillProvider |
| `budget.ts`、`token-usage.ts`、`types.ts` | `agent/` | 迭代预算、usage 统计、Agent 流事件类型均属 Agent 运行领域 |

标题生成的处理：规格要求"标题生成不再由 Agent 执行单元私自启动"，但非目标禁止修改运行行为、且 bridge 构造 REMAgent 的代码不能改。折中：把标题生成逻辑抽为独立模块 `agent/session-title.ts`（`forkSessionTitleGeneration`），由 `rem-agent.ts` 构造函数作为**协作编排**调用（规格 4.1 明确 rem-agent.ts 负责"公开生命周期操作和协作编排"）。行为逐字节保持。

## File Structure（目标目录）

```text
packages/core/src/
├── agent/            # REMAgent 生命周期、运行状态、输出构造、事件、预算、usage、bus
│   └── context/      # resolveREMAgentContext（types.ts + resolve.ts）
├── assembly/         # 组合根：agent-factory / agent-assembly(同步装配) / agent-context-assembler(纯DI) / agent-di / runtime-config / types
├── runtime/          # pi-agent 适配边界：assemble-pi-agent / pi-agent-factory / tool-bridge / context-bridge / pi-agent-like / generation/
├── session/          # model.ts + manager/ + tree/
├── tools/            # registry / composer / overlay / prompt-tool-summary
├── security/         # approval/ permissions/ rules/ workspace/ tool-policy/
├── capabilities/     # todo/ sub-agent/ prompt-tool-summary 不在这——在 tools/
├── sdk/              # 不动
├── plugins/          # 不动（除 agent-resolver、skill-parser 迁入；sqlite/config 内部拆分）
├── infrastructure/   # llm/ mcp/ config/ observability/
├── system-prompt/    # 不动
├── shared/           # 只剩 generate-id.ts
├── compat.ts         # 临时兼容出口（V2 别名）
└── index.ts          # 稳定 + 高级 + 兼容 三段式公共出口
```

每个 Task 末尾都有 commit。验证命令约定：
- 快速反馈：`pnpm --filter rem-agent-core typecheck`
- 批次收尾：`pnpm typecheck && pnpm test`（仓库根目录）

---

### Task 1: 导入重写 codemod

**Files:**
- Create: `packages/core/scripts/rewrite-imports.mjs`
- Create: `packages/core/scripts/governance-mappings/smoke.json`

后续每个迁移 Task 都是"写 mapping → git mv → 跑 codemod"。本 Task 先建好工具并用空 mapping 冒烟验证（空 mapping 下应输出 0 处重写、无未解析警告——这同时验证了脚本对全仓 import 的解析能力）。

- [ ] **Step 1: 写 codemod 脚本**

创建 `packages/core/scripts/rewrite-imports.mjs`：

```js
#!/usr/bin/env node
// 用法: node packages/core/scripts/rewrite-imports.mjs <mapping.json>
// mapping: { "<old src 相对路径>.ts": "<new src 相对路径>.ts" }
// 前置条件：文件已完成 git mv。本脚本重写 packages/core/src 与 packages/core/tests
// 下所有 .ts 文件中的相对 import/export，使其指向移动后的位置。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(coreRoot, 'src');
const mappingPath = resolve(process.cwd(), process.argv[2]);
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));

const oldToNew = new Map();
const newToOld = new Map();
for (const [oldRel, newRel] of Object.entries(mapping)) {
  const oldAbs = join(srcRoot, oldRel);
  const newAbs = join(srcRoot, newRel);
  oldToNew.set(oldAbs, newAbs);
  newToOld.set(newAbs, oldAbs);
}

const files = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.ts')) files.push(p);
  }
};
walk(srcRoot);
walk(join(coreRoot, 'tests'));

const specifierRe = /((?:from|import\s*\()\s*['"])(\.[^'"]+)(['"])/g;
let rewrittenFiles = 0;
let rewrittenSpecifiers = 0;
const unresolved = [];

for (const file of files) {
  // 移动过的文件：其内容的相对导入仍相对于旧位置解析
  const oldLoc = newToOld.get(file) ?? file;
  const content = readFileSync(file, 'utf8');
  let changed = false;
  const next = content.replace(specifierRe, (whole, prefix, spec, suffix) => {
    if (!spec.endsWith('.js')) return whole;
    const targetOld = resolve(dirname(oldLoc), spec.replace(/\.js$/, '.ts'));
    let targetNew = oldToNew.get(targetOld);
    if (!targetNew) {
      if (!existsSync(targetOld)) {
        unresolved.push(`${relative(coreRoot, file)}: ${spec}`);
        return whole;
      }
      targetNew = targetOld;
    }
    let rel = relative(dirname(file), targetNew).split(sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    const newSpec = rel.replace(/\.ts$/, '.js');
    if (newSpec === spec) return whole;
    changed = true;
    rewrittenSpecifiers++;
    return prefix + newSpec + suffix;
  });
  if (changed) {
    writeFileSync(file, next);
    rewrittenFiles++;
  }
}

console.log(`重写 ${rewrittenSpecifiers} 处导入，涉及 ${rewrittenFiles} 个文件`);
if (unresolved.length) {
  console.warn('以下导入未能解析（保持原样，需人工检查）：');
  for (const u of unresolved) console.warn(`  - ${u}`);
  process.exitCode = 2;
}
```

- [ ] **Step 2: 写空 mapping 并冒烟运行**

```bash
mkdir -p packages/core/scripts/governance-mappings
printf '{}' > packages/core/scripts/governance-mappings/smoke.json
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/smoke.json
```

Expected: 输出 `重写 0 处导入，涉及 0 个文件`，无"未能解析"警告（退出码 0）。

- [ ] **Step 3: 确认工作区无改动**

Run: `git status --porcelain`
Expected: 只有新增的 `packages/core/scripts/rewrite-imports.mjs` 和 `smoke.json` 两个 untracked 文件，无任何 src 文件被修改。

- [ ] **Step 4: Commit**

```bash
git add packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/smoke.json
git commit -m "chore(core): add import rewrite codemod for module governance"
```

---

### Task 2: 批次一 — infrastructure 迁移（llm / mcp / config / 日志）

**Files:**
- Create: `packages/core/scripts/governance-mappings/batch1-infrastructure.json`
- Move: `packages/core/src/llm/*` → `packages/core/src/infrastructure/llm/`（4 个文件）
- Move: `packages/core/src/mcp/*` → `packages/core/src/infrastructure/mcp/`（6 个文件）
- Move: `packages/core/src/config/paths.ts` → `packages/core/src/infrastructure/config/paths.ts`
- Move: `packages/core/src/shared/debug-log.ts`、`debug-log-file.ts` → `packages/core/src/infrastructure/observability/`
- Modify: `packages/core/package.json:20-23`（exports subpath target）
- Modify: `vitest.config.ts:18`（alias）

- [ ] **Step 1: 写 mapping**

创建 `packages/core/scripts/governance-mappings/batch1-infrastructure.json`：

```json
{
  "llm/context-window.ts": "infrastructure/llm/context-window.ts",
  "llm/models.ts": "infrastructure/llm/models.ts",
  "llm/patch-minimax-compat.ts": "infrastructure/llm/patch-minimax-compat.ts",
  "llm/reasoning-options.ts": "infrastructure/llm/reasoning-options.ts",
  "mcp/client.ts": "infrastructure/mcp/client.ts",
  "mcp/composite-tool-provider.ts": "infrastructure/mcp/composite-tool-provider.ts",
  "mcp/connection-manager.ts": "infrastructure/mcp/connection-manager.ts",
  "mcp/schema-converter.ts": "infrastructure/mcp/schema-converter.ts",
  "mcp/tool-provider.ts": "infrastructure/mcp/tool-provider.ts",
  "mcp/types.ts": "infrastructure/mcp/types.ts",
  "config/paths.ts": "infrastructure/config/paths.ts",
  "shared/debug-log.ts": "infrastructure/observability/debug-log.ts",
  "shared/debug-log-file.ts": "infrastructure/observability/debug-log-file.ts"
}
```

- [ ] **Step 2: git mv**

```bash
mkdir -p packages/core/src/infrastructure/llm packages/core/src/infrastructure/mcp packages/core/src/infrastructure/config packages/core/src/infrastructure/observability
git mv packages/core/src/llm/context-window.ts packages/core/src/llm/models.ts packages/core/src/llm/patch-minimax-compat.ts packages/core/src/llm/reasoning-options.ts packages/core/src/infrastructure/llm/
git mv packages/core/src/mcp/client.ts packages/core/src/mcp/composite-tool-provider.ts packages/core/src/mcp/connection-manager.ts packages/core/src/mcp/schema-converter.ts packages/core/src/mcp/tool-provider.ts packages/core/src/mcp/types.ts packages/core/src/infrastructure/mcp/
git mv packages/core/src/config/paths.ts packages/core/src/infrastructure/config/paths.ts
git mv packages/core/src/shared/debug-log.ts packages/core/src/shared/debug-log-file.ts packages/core/src/infrastructure/observability/
```

- [ ] **Step 3: 跑 codemod**

```bash
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/batch1-infrastructure.json
```

Expected: 输出重写数量 > 0，无"未能解析"警告。

- [ ] **Step 4: 改 package.json exports target（key 不变）**

`packages/core/package.json` 中把：

```json
    "./llm/context-window": {
      "import": "./dist/llm/context-window.js",
      "types": "./dist/llm/context-window.d.ts"
    }
```

改为：

```json
    "./llm/context-window": {
      "import": "./dist/infrastructure/llm/context-window.js",
      "types": "./dist/infrastructure/llm/context-window.d.ts"
    }
```

- [ ] **Step 5: 改根 vitest.config.ts alias**

把第 18 行：

```ts
      { find: 'rem-agent-core/llm/context-window', replacement: resolve(__dirname, 'packages/core/src/llm/context-window.ts') },
```

改为：

```ts
      { find: 'rem-agent-core/llm/context-window', replacement: resolve(__dirname, 'packages/core/src/infrastructure/llm/context-window.ts') },
```

- [ ] **Step 6: 批次一全量验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): migrate llm/mcp/config/logging into infrastructure/"
```

---

### Task 3: 批次二 — session/ 与 tools/ 迁移

**Files:**
- Create: `packages/core/scripts/governance-mappings/batch2-session-tools.json`
- Move: `session.ts` → `session/model.ts`；`session-manager/*`（5 个）→ `session/manager/`；`session-tree/*`（2 个）→ `session/tree/`
- Move: `registry/tool-registry.ts` → `tools/registry.ts`；`tool-composer.ts` → `tools/composer.ts`；`tool-overlay.ts` → `tools/overlay.ts`

- [ ] **Step 1: 写 mapping**

创建 `packages/core/scripts/governance-mappings/batch2-session-tools.json`：

```json
{
  "session.ts": "session/model.ts",
  "session-manager/agent-session-manager.ts": "session/manager/agent-session-manager.ts",
  "session-manager/errors.ts": "session/manager/errors.ts",
  "session-manager/index.ts": "session/manager/index.ts",
  "session-manager/message-blocks.ts": "session/manager/message-blocks.ts",
  "session-manager/types.ts": "session/manager/types.ts",
  "session-tree/context-builder.ts": "session/tree/context-builder.ts",
  "session-tree/types.ts": "session/tree/types.ts",
  "registry/tool-registry.ts": "tools/registry.ts",
  "tool-composer.ts": "tools/composer.ts",
  "tool-overlay.ts": "tools/overlay.ts"
}
```

- [ ] **Step 2: git mv**

```bash
mkdir -p packages/core/src/session/manager packages/core/src/session/tree packages/core/src/tools
git mv packages/core/src/session.ts packages/core/src/session/model.ts
git mv packages/core/src/session-manager/agent-session-manager.ts packages/core/src/session-manager/errors.ts packages/core/src/session-manager/index.ts packages/core/src/session-manager/message-blocks.ts packages/core/src/session-manager/types.ts packages/core/src/session/manager/
git mv packages/core/src/session-tree/context-builder.ts packages/core/src/session-tree/types.ts packages/core/src/session/tree/
git mv packages/core/src/registry/tool-registry.ts packages/core/src/tools/registry.ts
git mv packages/core/src/tool-composer.ts packages/core/src/tools/composer.ts
git mv packages/core/src/tool-overlay.ts packages/core/src/tools/overlay.ts
```

- [ ] **Step 3: 跑 codemod**

```bash
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/batch2-session-tools.json
```

Expected: 无"未能解析"警告。

- [ ] **Step 4: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm test`
Expected: 通过（session 路径被 bridge 大量使用，必须跑全量 test）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core): unify session domain and tools orchestration directories"
```

---

### Task 4: 批次二 — security/ 收拢（approval / workspace / tool-policy / exec-classifier）

**Files:**
- Create: `packages/core/scripts/governance-mappings/batch2-security.json`
- Move: `execute/*`（2 个）→ `security/approval/`；`security/workspace-*`（2 个）→ `security/workspace/`；`security/tool-policy-*`（3 个）→ `security/tool-policy/`；`security/exec-classifier.ts` → `security/permissions/`；`types/bash-parser.d.ts` → `security/permissions/`

- [ ] **Step 1: 写 mapping**

创建 `packages/core/scripts/governance-mappings/batch2-security.json`：

```json
{
  "execute/approval-engine.ts": "security/approval/approval-engine.ts",
  "execute/request-approval.ts": "security/approval/request-approval.ts",
  "security/workspace-outside-error.ts": "security/workspace/workspace-outside-error.ts",
  "security/workspace-root-guard.ts": "security/workspace/workspace-root-guard.ts",
  "security/tool-policy-pipeline.ts": "security/tool-policy/tool-policy-pipeline.ts",
  "security/tool-policy-profile.ts": "security/tool-policy/tool-policy-profile.ts",
  "security/tool-policy-shared.ts": "security/tool-policy/tool-policy-shared.ts",
  "security/exec-classifier.ts": "security/permissions/exec-classifier.ts",
  "types/bash-parser.d.ts": "security/permissions/bash-parser.d.ts"
}
```

- [ ] **Step 2: git mv**

```bash
mkdir -p packages/core/src/security/approval packages/core/src/security/workspace packages/core/src/security/tool-policy
git mv packages/core/src/execute/approval-engine.ts packages/core/src/execute/request-approval.ts packages/core/src/security/approval/
git mv packages/core/src/security/workspace-outside-error.ts packages/core/src/security/workspace-root-guard.ts packages/core/src/security/workspace/
git mv packages/core/src/security/tool-policy-pipeline.ts packages/core/src/security/tool-policy-profile.ts packages/core/src/security/tool-policy-shared.ts packages/core/src/security/tool-policy/
git mv packages/core/src/security/exec-classifier.ts packages/core/src/security/permissions/exec-classifier.ts
git mv packages/core/src/types/bash-parser.d.ts packages/core/src/security/permissions/bash-parser.d.ts
```

- [ ] **Step 3: 跑 codemod**

```bash
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/batch2-security.json
```

Expected: 无"未能解析"警告。

- [ ] **Step 4: 确认空目录已清空**

Run: `ls packages/core/src/execute packages/core/src/types packages/core/src/registry 2>&1`
Expected: 三个目录均不存在（git mv 后空目录自动消失）。

- [ ] **Step 5: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm test`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(core): fold approval/workspace/tool-policy into security capabilities"
```

---

### Task 5: 批次二 — SQLite schema 拆分（281 行 → 入口 ~50 行）

`schema.ts` 超过实现文件绝对上限（200 行）。按规格拆为：5 个按领域的 DDL 常量文件 + 1 个版本迁移文件 + 1 个聚合入口。先写刻画测试，再拆分。

**Files:**
- Test: `packages/core/tests/sqlite-storage.test.ts`（新建，Task 6 复用）
- Create: `packages/core/src/plugins/storage/sqlite/schema/session-ddl.ts`、`rule-ddl.ts`、`todo-ddl.ts`、`archive-ddl.ts`、`workspace-ddl.ts`、`migrations.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/schema.ts`（整体重写为 ~50 行入口）

- [ ] **Step 1: 写刻画测试（针对现有实现，应先通过）**

创建 `packages/core/tests/sqlite-storage.test.ts`：

```ts
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteSessionStore } from '../src/plugins/storage/sqlite/session-store.js';

const createStore = () => {
  const db = new Database(':memory:');
  new SqliteSchemaManager(db).migrate();
  return { db, store: new SqliteSessionStore(db) };
};

describe('SqliteSchemaManager', () => {
  it('migrates a fresh database to the current schema version', () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(CURRENT_SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ['sessions', 'messages', 'rules', 'todos', 'archived_messages', 'workspaces', 'session_entries']) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent and preserves data across re-migrate', () => {
    const { db } = createStore();
    db.prepare("INSERT INTO workspaces (path, created_at) VALUES ('/tmp/ws', 1)").run();
    new SqliteSchemaManager(db).migrate();
    const ws = db.prepare('SELECT path FROM workspaces').all() as { path: string }[];
    expect(ws).toEqual([{ path: '/tmp/ws' }]);
  });
});

describe('SqliteSessionStore', () => {
  it('create/load roundtrip', async () => {
    const { store } = createStore();
    const session = await store.create('ws');
    const loaded = await store.load(session.sessionId);
    expect(loaded?.sessionId).toBe(session.sessionId);
    expect(loaded?.conversation).toEqual([]);
  });

  it('save() persists metadata and reconciles conversation without duplicating entries', async () => {
    const { store } = createStore();
    const session = await store.create('ws');
    session.metadata.title = 't';
    session.conversation = [{ role: 'user', content: 'hi', timestamp: 1 } as never];
    await store.save(session);
    const loaded = await store.load(session.sessionId);
    expect(loaded?.metadata.title).toBe('t');
    expect(loaded?.conversation).toHaveLength(1);
    await store.save(session);
    const again = await store.load(session.sessionId);
    expect(again?.conversation).toHaveLength(1);
  });

  it('listByWorkspace returns summaries and delete removes the session', async () => {
    const { store } = createStore();
    const session = await store.create('ws-a');
    await store.create('ws-b');
    const list = await store.listByWorkspace('ws-a');
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe(session.sessionId);
    await store.delete(session.sessionId);
    expect(await store.load(session.sessionId)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行刻画测试确认通过**

Run: `pnpm vitest run packages/core/tests/sqlite-storage.test.ts`
Expected: 5 个测试全部 PASS（在拆分前的现有实现上）。

- [ ] **Step 3: 创建 5 个 DDL 文件**

`packages/core/src/plugins/storage/sqlite/schema/session-ddl.ts`：

```ts
/** sessions / messages / session_entries 三张表的当前 schema DDL */
export const SESSION_DDL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL,
    title TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    current_turn INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    active_leaf_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated
    ON sessions(workspace, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    tool_call_id TEXT,
    tool_name TEXT,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_sequence
    ON messages(session_id, sequence);

  CREATE TABLE IF NOT EXISTS session_entries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    parent_id TEXT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_entries_session
    ON session_entries(session_id);
`;
```

`packages/core/src/plugins/storage/sqlite/schema/rule-ddl.ts`：

```ts
/** rules 表的当前 schema DDL */
export const RULE_DDL = `
  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    permission TEXT NOT NULL,
    pattern TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rules_source
    ON rules(source);
`;
```

`packages/core/src/plugins/storage/sqlite/schema/todo-ddl.ts`：

```ts
/** todos 表的当前 schema DDL（每 session 一行 JSON） */
export const TODO_DDL = `
  CREATE TABLE IF NOT EXISTS todos (
    session_id TEXT PRIMARY KEY,
    todos_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
```

`packages/core/src/plugins/storage/sqlite/schema/archive-ddl.ts`：

```ts
/** archived_messages 表的当前 schema DDL */
export const ARCHIVE_DDL = `
  CREATE TABLE IF NOT EXISTS archived_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    compressed_at TEXT NOT NULL,
    version INTEGER NOT NULL,
    parent_archive_id TEXT,
    conversation_snapshot TEXT NOT NULL,
    summary TEXT NOT NULL,
    token_usage_before TEXT,
    token_usage_after TEXT,
    metadata TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_archived_messages_session
    ON archived_messages(session_id);

  CREATE INDEX IF NOT EXISTS idx_archived_messages_version
    ON archived_messages(session_id, version);
`;
```

`packages/core/src/plugins/storage/sqlite/schema/workspace-ddl.ts`：

```ts
/** workspaces 表的当前 schema DDL */
export const WORKSPACE_DDL = `
  CREATE TABLE IF NOT EXISTS workspaces (
    path TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
`;
```

- [ ] **Step 4: 用 sed 从旧文件提取迁移体，生成 migrations.ts**

迁移体是旧 `schema.ts` 第 121-279 行（`migrateFrom` 方法体内全部 `if (version < N)` 块），原样保留，仅把 `this.db` 替换为参数 `db`：

```bash
mkdir -p packages/core/src/plugins/storage/sqlite/schema
sed -n '121,279p' packages/core/src/plugins/storage/sqlite/schema.ts | sed 's/this\.db/db/g' > /tmp/rem-migrations-body.txt
{ printf 'import Database from '"'"'better-sqlite3'"'"';\n\n/** 版本迁移：从旧 schema 版本逐级升级到 CURRENT_SCHEMA_VERSION（由 schema.ts 调用） */\nexport function runMigrations(db: Database.Database, version: number): void {\n'; cat /tmp/rem-migrations-body.txt; printf '}\n'; } > packages/core/src/plugins/storage/sqlite/schema/migrations.ts
```

检查生成结果：

Run: `grep -c "this\.db" packages/core/src/plugins/storage/sqlite/schema/migrations.ts; grep -c "if (version <" packages/core/src/plugins/storage/sqlite/schema/migrations.ts`
Expected: 第一个命令输出 `0`；第二个命令输出 `6`（version < 2/3/5/6/8/9 共 6 块）。

- [ ] **Step 5: 重写 schema.ts 为聚合入口**

把 `packages/core/src/plugins/storage/sqlite/schema.ts` 整体替换为：

```ts
import Database from 'better-sqlite3';
import { SESSION_DDL } from './schema/session-ddl.js';
import { RULE_DDL } from './schema/rule-ddl.js';
import { TODO_DDL } from './schema/todo-ddl.js';
import { ARCHIVE_DDL } from './schema/archive-ddl.js';
import { WORKSPACE_DDL } from './schema/workspace-ddl.js';
import { runMigrations } from './schema/migrations.js';

export const CURRENT_SCHEMA_VERSION = 9;

export class SqliteSchemaManager {
  constructor(private db: Database.Database) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);
    this.db.exec(SESSION_DDL);
    this.db.exec(RULE_DDL);
    this.db.exec(TODO_DDL);
    this.db.exec(ARCHIVE_DDL);
    this.db.exec(WORKSPACE_DDL);

    const row = this.db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined;

    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
      return;
    }

    if (row.version === CURRENT_SCHEMA_VERSION) return;
    if (row.version > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported schema version: ${row.version}`);
    }

    runMigrations(this.db, row.version);
    this.db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_SCHEMA_VERSION);
  }
}
```

- [ ] **Step 6: 验证（刻画测试 + 类型检查）**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests/sqlite-storage.test.ts`
Expected: typecheck 通过；5 个测试全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): split sqlite schema into domain DDL modules and migrations"
```

---

### Task 6: 批次二 — SQLite session-store 拆分（215 行 → ~120 行）

拆出行映射（`session-entry-rows.ts`）和过渡期 reconcile 逻辑（`session-reconcile.ts`），Store 只保留 CRUD 编排。复用 Task 5 的刻画测试。

**Files:**
- Create: `packages/core/src/plugins/storage/sqlite/session-entry-rows.ts`
- Create: `packages/core/src/plugins/storage/sqlite/session-reconcile.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/session-store.ts`（整体重写）
- Test: `packages/core/tests/sqlite-storage.test.ts`（Task 5 已建，不改）

- [ ] **Step 1: 创建 session-entry-rows.ts**

```ts
import type { SessionTreeEntry } from '../../../session/tree/types.js';

/** session_entries 表行结构 */
export interface SessionEntryRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  type: string;
  payload: string;
  created_at: number;
}

export function toSessionTreeEntry(row: SessionEntryRow): SessionTreeEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id,
    type: row.type as SessionTreeEntry['type'],
    payload: JSON.parse(row.payload),
    timestamp: row.created_at,
  };
}
```

- [ ] **Step 2: 创建 session-reconcile.ts**

```ts
import type { Session } from '../../../session/model.js';
import type { SessionTreeEntry } from '../../../session/tree/types.js';
import { buildConversationFromEntries } from '../../../session/tree/context-builder.js';
import { generateId } from '../../../shared/generate-id.js';

/** reconcile 依赖的最小 Store 面（由 SqliteSessionStore 满足） */
export interface SessionEntryStore {
  listEntries(sessionId: string): Promise<SessionTreeEntry[]>;
  getActiveLeafId(sessionId: string): Promise<string | null>;
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  updateEntry(entry: SessionTreeEntry): void;
}

/**
 * 过渡期 reconcile：旧流程通过 save() 持久化消息，新流程经 appendEntry 增量写入。
 * 对比 leaf 链后，新流程下此函数自然成为 no-op。
 */
export async function reconcileSessionEntries(store: SessionEntryStore, session: Session): Promise<void> {
  const entries = await store.listEntries(session.sessionId);
  const leafId = await store.getActiveLeafId(session.sessionId);
  const persisted = buildConversationFromEntries(entries, leafId);

  if (session.conversation.length > persisted.length) {
    for (let i = persisted.length; i < session.conversation.length; i++) {
      const message = session.conversation[i];
      const entryId = generateId();
      await store.appendEntry({
        id: entryId,
        sessionId: session.sessionId,
        parentId: await store.getActiveLeafId(session.sessionId),
        type: 'message',
        payload: { message, messageId: entryId },
        timestamp: Date.now(),
      });
    }
  } else if (session.conversation.length > 0 && session.conversation.length === persisted.length) {
    const lastMessage = session.conversation[session.conversation.length - 1];
    const lastPersisted = persisted[persisted.length - 1];
    if (JSON.stringify(lastMessage) !== JSON.stringify(lastPersisted)) {
      const leafEntry = entries.find((e) => e.id === leafId);
      if (leafEntry) {
        const messageId = (leafEntry.payload as { messageId?: string }).messageId ?? leafEntry.id;
        store.updateEntry({ ...leafEntry, payload: { message: lastMessage, messageId } });
      }
    }
  }
}
```

- [ ] **Step 3: 重写 session-store.ts**

把 `packages/core/src/plugins/storage/sqlite/session-store.ts` 整体替换为：

```ts
import Database from 'better-sqlite3';
import { generateId } from '../../../shared/generate-id.js';
import type { Session, SessionSummary } from '../../../session/model.js';
import type { SessionStore } from '../../../sdk/storage-provider.js';
import type { SessionTreeEntry } from '../../../session/tree/types.js';
import { buildConversationFromEntries } from '../../../session/tree/context-builder.js';
import { wrapSqliteError } from './errors.js';
import { toSession, toSessionSummary } from './session-converter.js';
import { toSessionTreeEntry, type SessionEntryRow } from './session-entry-rows.js';
import { reconcileSessionEntries } from './session-reconcile.js';

export class SqliteSessionStore implements SessionStore {
  constructor(private db: Database.Database) {}

  async create(workspace: string): Promise<Session> {
    try {
      const now = new Date();
      const sessionId = generateId();
      this.db
        .prepare(
          `INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(sessionId, workspace, null, 0, 0, '{}', now.toISOString(), now.toISOString());

      return {
        sessionId,
        conversation: [],
        currentTurn: 0,
        metadata: { workspace, schemaVersion: 2 },
        createdAt: now,
        updatedAt: now,
      };
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to create session');
    }
  }

  async load(sessionId: string): Promise<Session | null> {
    try {
      const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
        | import('./session-converter.js').SessionRow
        | undefined;
      if (!row) return null;

      const entries = await this.listEntries(sessionId);
      const leafId = await this.getActiveLeafId(sessionId);
      const messages = buildConversationFromEntries(entries, leafId);

      return toSession(row, messages);
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to load session ${sessionId}`);
    }
  }

  async save(session: Session): Promise<void> {
    const title = typeof session.metadata.title === 'string' ? session.metadata.title : null;
    const pinned = session.metadata.pinned === true ? 1 : 0;
    const workspace =
      typeof session.metadata.workspace === 'string' ? session.metadata.workspace : 'default';

    const metadata = { ...session.metadata };
    delete metadata.title;
    delete metadata.pinned;
    delete metadata.workspace;

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             workspace = excluded.workspace,
             title = excluded.title,
             pinned = excluded.pinned,
             current_turn = excluded.current_turn,
             metadata_json = excluded.metadata_json,
             updated_at = excluded.updated_at`
        )
        .run(
          session.sessionId,
          workspace,
          title,
          pinned,
          session.currentTurn,
          JSON.stringify(metadata),
          session.createdAt.toISOString(),
          new Date().toISOString()
        );
    });

    try {
      transaction();
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to save session ${session.sessionId}`);
    }

    await reconcileSessionEntries(this, session);
  }

  updateEntry(entry: SessionTreeEntry): void {
    this.db
      .prepare('UPDATE session_entries SET payload = ? WHERE id = ?')
      .run(JSON.stringify(entry.payload), entry.id);
  }

  async delete(sessionId: string): Promise<void> {
    try {
      // todos has no FK to sessions (see schema v7), so clean it up explicitly.
      this.db.prepare('DELETE FROM todos WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to delete session ${sessionId}`);
    }
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    try {
      const tx = this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO session_entries (id, session_id, parent_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(entry.id, entry.sessionId, entry.parentId, entry.type, JSON.stringify(entry.payload), entry.timestamp);
        this.db.prepare('UPDATE sessions SET active_leaf_id = ? WHERE id = ?').run(entry.id, entry.sessionId);
      });
      tx();
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to append entry ${entry.id}`);
    }
  }

  async getActiveLeafId(sessionId: string): Promise<string | null> {
    const row = this.db.prepare('SELECT active_leaf_id FROM sessions WHERE id = ?').get(sessionId) as
      | { active_leaf_id: string | null }
      | undefined;
    return row?.active_leaf_id ?? null;
  }

  async listEntries(sessionId: string): Promise<SessionTreeEntry[]> {
    const rows = this.db
      .prepare('SELECT id, session_id, parent_id, type, payload, created_at FROM session_entries WHERE session_id = ? ORDER BY rowid')
      .all(sessionId) as SessionEntryRow[];
    return rows.map(toSessionTreeEntry);
  }

  async listByWorkspace(workspace: string): Promise<SessionSummary[]> {
    return this.listWithWhere('workspace = ?', [workspace]);
  }

  async listAll(): Promise<SessionSummary[]> {
    return this.listWithWhere('1 = 1', []);
  }

  private listWithWhere(
    whereClause: string,
    params: (string | number)[]
  ): SessionSummary[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT id, title, pinned, updated_at,
            (SELECT COUNT(*) FROM session_entries WHERE session_id = sessions.id AND type = 'message') AS message_count
           FROM sessions
           WHERE ${whereClause}
           ORDER BY updated_at DESC`
        )
        .all(...params) as Array<{
        id: string;
        title: string | null;
        pinned: number;
        updated_at: string;
        message_count: number;
      } >;

      return rows.map(toSessionSummary);
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to list sessions');
    }
  }
}
```

- [ ] **Step 4: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests/sqlite-storage.test.ts`
Expected: typecheck 通过；5 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core): extract sqlite session entry mapping and reconcile from store"
```

---

### Task 7: 批次二 — DefaultConfigProvider 拆分（209 行 → 入口纯聚合）+ 批次二收尾验证

`index.ts` 降为纯聚合出口；Provider 实现、模型解析、MCP 解析分别独立文件。本文件没有"文件监听"逻辑（规格描述与现状有偏差），按现状拆即可。先写刻画测试。

**Files:**
- Test: `packages/core/tests/default-config-provider.test.ts`（新建）
- Create: `packages/core/src/plugins/config/default/model-config-resolver.ts`、`mcp-config-resolver.ts`、`default-config-provider.ts`
- Modify: `packages/core/src/plugins/config/default/index.ts`（整体重写为聚合出口）

- [ ] **Step 1: 写刻画测试（针对现有实现，应先通过）**

创建 `packages/core/tests/default-config-provider.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { DefaultConfigProvider } from '../src/plugins/config/default/index.js';
import { createDefaultAgentPaths } from '../src/infrastructure/config/paths.js';

const paths = createDefaultAgentPaths({
  agentDir: '/tmp/rem-agent-test-nonexistent',
  homeAgentDir: '/tmp/rem-agent-test-nonexistent-home',
  env: {},
});

describe('DefaultConfigProvider', () => {
  it('throws when reading config before initialization', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    expect(() => provider.getConfig()).toThrow('DefaultConfigProvider must be initialized');
  });

  it('resolves default model config from provider env fallbacks', () => {
    const provider = new DefaultConfigProvider({
      env: { OPENAI_MODEL: 'gpt-env' } as NodeJS.ProcessEnv,
      paths,
    });
    const model = provider.getModelConfig();
    expect(model.provider).toBe('openai');
    expect(model.model).toBe('gpt-env');
  });

  it('forWorkspace returns a cached scoped provider', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    const scoped = provider.forWorkspace('/tmp/rem-agent-test-nonexistent-ws');
    expect(scoped).toBe(provider.forWorkspace('/tmp/rem-agent-test-nonexistent-ws'));
  });
});
```

- [ ] **Step 2: 运行刻画测试确认通过**

Run: `pnpm vitest run packages/core/tests/default-config-provider.test.ts`
Expected: 3 个测试全部 PASS。

- [ ] **Step 3: 创建 model-config-resolver.ts**

`packages/core/src/plugins/config/default/model-config-resolver.ts`：

```ts
import type { AgentModelConfig, ResolvedModelConfig } from '../../../sdk/config-provider.js';
import { isThinkingLevel, resolveOptionalTemplate, resolveTemplate } from './config-parser.js';

/** 解析单个模型配置：空值回落到 <PROVIDER>_* 环境变量，apiKey/baseURL 支持 ${VAR} 模板 */
export function resolveModelConfig(model: AgentModelConfig, env: NodeJS.ProcessEnv): ResolvedModelConfig {
  const resolvedModel = model.model || readProviderEnv(model.provider, 'MODEL', env) || '';
  const resolvedBaseURL =
    resolveOptionalTemplate(model.baseURL, env) ?? readProviderEnv(model.provider, 'BASE_URL', env);
  const configuredReasoning = model.reasoning ?? readProviderEnv(model.provider, 'REASONING_LEVEL', env);
  return {
    provider: model.provider,
    model: resolvedModel,
    apiKey: model.apiKey ? resolveTemplate(model.apiKey, env) : '',
    baseURL: resolvedBaseURL,
    reasoning: isThinkingLevel(configuredReasoning) ? configuredReasoning : undefined,
  };
}

export function readProviderEnv(provider: string, suffix: string, env: NodeJS.ProcessEnv): string | undefined {
  const key = `${provider.toUpperCase()}_${suffix}`;
  const value = env[key];
  return value || undefined;
}
```

- [ ] **Step 4: 创建 mcp-config-resolver.ts**

`packages/core/src/plugins/config/default/mcp-config-resolver.ts`：

```ts
import type { McpServerConfig } from '../../../infrastructure/mcp/types.js';
import { resolveTemplate } from './config-parser.js';

/** 解析 MCP server 配置：env 字段中的 ${VAR} 模板替换为进程环境变量 */
export function resolveMcpServerConfig(config: McpServerConfig, env: NodeJS.ProcessEnv): McpServerConfig {
  const resolved: McpServerConfig = { ...config } as any;
  if (config.env) {
    const resolvedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.env)) {
      resolvedEnv[k] = resolveTemplate(v, env);
    }
    (resolved as any).env = resolvedEnv;
  }
  return resolved;
}

export function resolveMcpConfig(
  servers: Record<string, McpServerConfig>,
  env: NodeJS.ProcessEnv,
): Record<string, McpServerConfig> {
  const resolved: Record<string, McpServerConfig> = {};
  for (const [key, config] of Object.entries(servers)) {
    resolved[key] = resolveMcpServerConfig(config, env);
  }
  return resolved;
}
```

- [ ] **Step 5: 创建 default-config-provider.ts**

`packages/core/src/plugins/config/default/default-config-provider.ts`：

```ts
import type {
  AgentConfig,
  AgentBehaviorConfig,
  AgentToolConfig,
  ConfigProvider,
  ResolvedAgentConfig,
  ResolvedModelConfig,
} from '../../../sdk/config-provider.js';
import type { AgentResolver, ResolvedAgentRole } from '../../../sdk/agent-role.js';
import type { McpServerConfig } from '../../../infrastructure/mcp/types.js';
import type { AgentPaths } from '../../../infrastructure/config/paths.js';
import { loadConfigFile, loadConfigFileSync, resolveConfigPaths } from './config-loader.js';
import { mergeFileConfig, mergeEnvConfig, applyBehaviorDefaults, mergeDeepConfig } from './config-merger.js';
import { DefaultAgentResolver } from '../../../agent-resolver.js';
import { resolveModelConfig } from './model-config-resolver.js';
import { resolveMcpConfig } from './mcp-config-resolver.js';

export interface DefaultConfigProviderOptions {
  env?: NodeJS.ProcessEnv;
  paths?: AgentPaths;
}

export class DefaultConfigProvider implements ConfigProvider {
  private raw?: AgentConfig;
  private rawHome?: AgentConfig;
  private env: NodeJS.ProcessEnv;
  private _paths?: AgentPaths;
  private agentResolver?: AgentResolver;
  private workspaceCache = new Map<string, ConfigProvider>();

  constructor(private options: DefaultConfigProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this._paths = options.paths;
    if (this._paths) {
      this.loadSync();
    }
  }

  private loadSync(): void {
    const paths = this._paths as AgentPaths;
    let home: AgentConfig = {};
    const homePath = resolveConfigPaths(paths.homeConfigCandidates())[0];
    if (homePath) {
      home = mergeFileConfig(home, loadConfigFileSync(homePath));
    }
    this.rawHome = home;
    this.raw = mergeEnvConfig(home, this.env);
    this.initResolver();
  }

  private async resolvePaths(): Promise<AgentPaths> {
    if (this._paths) return this._paths;
    const { createDefaultAgentPaths } = await import('../../../infrastructure/config/paths.js');
    this._paths = createDefaultAgentPaths({ env: this.env });
    return this._paths;
  }

  async init(): Promise<void> {
    if (this._paths) {
      this.loadSync();
      return;
    }
    let home: AgentConfig = {};

    const paths = await this.resolvePaths();

    const homePath = resolveConfigPaths(paths.homeConfigCandidates())[0];
    if (homePath) {
      const homeFile = await loadConfigFile(homePath);
      home = mergeFileConfig(home, homeFile);
    }

    this.rawHome = home;
    this.raw = mergeEnvConfig(home, this.env);
    this.initResolver();
  }

  forWorkspace(workspace: string): ConfigProvider {
    const cached = this.workspaceCache.get(workspace);
    if (cached) return cached;

    const workspacePath = resolveConfigPaths(
      (this._paths as AgentPaths).workspaceConfigCandidates(workspace),
    )[0];

    // 合并优先级：home < workspace 配置文件 < env
    let raw = this.getRawConfig();
    if (workspacePath) {
      raw = mergeEnvConfig(mergeDeepConfig(this.rawHome ?? {}, loadConfigFileSync(workspacePath)), this.env);
    }

    const scoped = new DefaultConfigProvider({ env: this.env, paths: this._paths });
    scoped.raw = raw;
    scoped.initResolver();
    this.workspaceCache.set(workspace, scoped);
    return scoped;
  }

  private initResolver(): void {
    this.agentResolver = new DefaultAgentResolver({
      behavior: this.getBehaviorConfig(),
      agents: this.getRawConfig().agents,
      resolveModel: (model) => {
        if (!model || !model.provider || !model.model) return undefined;
        return resolveModelConfig(model, this.env);
      },
    });
  }

  private getRawConfig(): AgentConfig {
    if (!this.raw) {
      throw new Error('DefaultConfigProvider must be initialized before reading config');
    }
    return this.raw;
  }

  getConfig(): ResolvedAgentConfig {
    return {
      ...this.getBehaviorConfig(),
      policy: this.getToolConfig().policy,
      model: this.getModelConfig(),
    };
  }

  getModelConfig(modelId?: string): ResolvedModelConfig {
    const cfg = this.getRawConfig();
    const id = modelId ?? cfg.activeModel ?? 'default';
    const model = cfg.models?.[id] ?? cfg.model ?? { provider: 'openai', model: '' };
    return resolveModelConfig(model, this.env);
  }

  getToolConfig(): AgentToolConfig {
    const cfg = this.getRawConfig();
    return {
      policy: cfg.toolPolicy,
    };
  }

  getBehaviorConfig(): Required<AgentBehaviorConfig> {
    if (!this._paths) {
      throw new Error('DefaultConfigProvider must be initialized before reading behavior config');
    }
    return applyBehaviorDefaults(this.getRawConfig());
  }

  getMcpConfig(): Record<string, McpServerConfig> {
    const cfg = this.getRawConfig();
    return resolveMcpConfig(cfg.mcpServers ?? {}, this.env);
  }

  getCompressionConfig(): Required<import('../../../sdk/config-provider.js').CompressionConfig> {
    return this.getBehaviorConfig().compression as Required<import('../../../sdk/config-provider.js').CompressionConfig>;
  }

  resolveAgent(id?: string): ResolvedAgentRole {
    if (!this.agentResolver) {
      throw new Error('DefaultConfigProvider must be initialized before resolving agent');
    }
    return this.agentResolver.resolveAgent(id);
  }
}
```

注意三处与旧实现的对应关系（行为不变）：
1. 原私有方法 `resolveModelConfig`/`readProviderEnv` → `model-config-resolver.ts` 的纯函数，传入 `this.env`。
2. 原 `getMcpConfig` 的循环 → `resolveMcpConfig(cfg.mcpServers ?? {}, this.env)`。
3. 原 `import type { AgentModelConfig }` 和 `resolveTemplate, resolveOptionalTemplate, isThinkingLevel` 在本文件不再需要；`mergeDeepConfig` 仍在用。

- [ ] **Step 6: 重写 index.ts 为纯聚合出口**

把 `packages/core/src/plugins/config/default/index.ts` 整体替换为：

```ts
export { DefaultConfigProvider, type DefaultConfigProviderOptions } from './default-config-provider.js';

export interface ConfigFileData {
  [key: string]: unknown;
}
```

- [ ] **Step 7: 验证（刻画测试 + 类型检查）**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests/default-config-provider.test.ts`
Expected: typecheck 通过；3 个测试全部 PASS。

- [ ] **Step 8: 批次二全量验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(core): split DefaultConfigProvider into provider, model and mcp resolvers"
```

---

### Task 8: 批次三 — capabilities 迁移 + delegate-task 去 v2 + 建立 compat.ts

规格要求：正式实现去掉 `v2` 命名，旧名称通过兼容层保留。符号改名清单（4 个）：
- `DelegateTaskInputV2` → `DelegateTaskInput`
- `createDelegateTaskToolDefinitionV2` → `createDelegateTaskToolDefinition`
- `DelegateTaskExecutorV2Params` → `DelegateTaskExecutorParams`
- `createDelegateTaskExecutorV2` → `createDelegateTaskExecutor`
- `SpawnChild` 名字不变。

内部引用这些符号的文件（改名后必须同步）：`src/agent-context.ts`、`src/assemble-pi-agent.ts`（这两个文件在批次四/五才移动，本 Task 在原路径上改）。`src/rem-agent.ts` 只引用 `SpawnChild`（名字不变，无需改）。根 `index.ts` **不能用 sed 批量改**（它要继续导出旧的 V2 名，改由 compat.ts 提供），单独手工改。

**Files:**
- Create: `packages/core/scripts/governance-mappings/batch3-capabilities.json`
- Move: `todo/*`（3 个）→ `capabilities/todo/`；`sub-agent/*`（2 个）→ `capabilities/sub-agent/`；`delegate-task-v2.ts` → `capabilities/sub-agent/delegate-task.ts`
- Move: `packages/core/tests/delegate-task-v2.test.ts` → `packages/core/tests/delegate-task.test.ts`
- Create: `packages/core/src/compat.ts`
- Modify: `packages/core/src/index.ts`（delegate 导出段）

- [ ] **Step 1: 写 mapping**

创建 `packages/core/scripts/governance-mappings/batch3-capabilities.json`：

```json
{
  "todo/errors.ts": "capabilities/todo/errors.ts",
  "todo/service.ts": "capabilities/todo/service.ts",
  "todo/types.ts": "capabilities/todo/types.ts",
  "sub-agent/build-child-context.ts": "capabilities/sub-agent/build-child-context.ts",
  "sub-agent/format-task-result.ts": "capabilities/sub-agent/format-task-result.ts",
  "delegate-task-v2.ts": "capabilities/sub-agent/delegate-task.ts"
}
```

- [ ] **Step 2: git mv（含测试文件改名）**

```bash
mkdir -p packages/core/src/capabilities/todo packages/core/src/capabilities/sub-agent
git mv packages/core/src/todo/errors.ts packages/core/src/todo/service.ts packages/core/src/todo/types.ts packages/core/src/capabilities/todo/
git mv packages/core/src/sub-agent/build-child-context.ts packages/core/src/sub-agent/format-task-result.ts packages/core/src/capabilities/sub-agent/
git mv packages/core/src/delegate-task-v2.ts packages/core/src/capabilities/sub-agent/delegate-task.ts
git mv packages/core/tests/delegate-task-v2.test.ts packages/core/tests/delegate-task.test.ts
```

- [ ] **Step 3: 跑 codemod**

```bash
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/batch3-capabilities.json
```

Expected: 无"未能解析"警告。

- [ ] **Step 4: 批量改符号名（不含 index.ts）**

```bash
sed -i '' \
  -e 's/createDelegateTaskToolDefinitionV2/createDelegateTaskToolDefinition/g' \
  -e 's/createDelegateTaskExecutorV2/createDelegateTaskExecutor/g' \
  -e 's/DelegateTaskExecutorV2Params/DelegateTaskExecutorParams/g' \
  -e 's/DelegateTaskInputV2/DelegateTaskInput/g' \
  packages/core/src/capabilities/sub-agent/delegate-task.ts \
  packages/core/src/agent-context.ts \
  packages/core/src/assemble-pi-agent.ts \
  packages/core/tests/delegate-task.test.ts
```

同时把 `delegate-task.ts` 中两处注释里的 "v2" 字样去掉：
- 第 17 行注释 `/** bridge 注入：创建 child session + 装配 child REMAgent */` 不变；
- 把 `/**\n * v2 delegate_task executor：...` 开头的文档注释改为 `/** delegate_task executor：spawnChild 拿 child REMAgent 挂树（触发 child-spawned），drain 子事件流，等待 output 组装工具结果。子 Agent 出错不传染父 Agent。 */`。

- [ ] **Step 5: 创建 compat.ts**

创建 `packages/core/src/compat.ts`：

```ts
// 临时兼容出口：集中保留"不应长期存在"的旧 API 名称。
// 删除条件：bridge / routes / ui / web 等 workspace 调用方全部迁移到新名称后，本文件整体删除。

export {
  createDelegateTaskToolDefinition as createDelegateTaskToolDefinitionV2,
  createDelegateTaskExecutor as createDelegateTaskExecutorV2,
} from './capabilities/sub-agent/delegate-task.js';
export type {
  DelegateTaskInput as DelegateTaskInputV2,
  DelegateTaskExecutorParams as DelegateTaskExecutorV2Params,
} from './capabilities/sub-agent/delegate-task.js';
```

- [ ] **Step 6: 改 index.ts 的 delegate 导出段**

在 `packages/core/src/index.ts` 中找到以 `from './capabilities/sub-agent/delegate-task.js';` 结尾、导出 4 个 V2 符号 + `SpawnChild` 的整条 export 语句（codemod 已把路径改对，但符号名还是 V2），替换为：

```ts
export { createDelegateTaskExecutor, createDelegateTaskToolDefinition, type DelegateTaskExecutorParams, type DelegateTaskInput, type SpawnChild } from './capabilities/sub-agent/delegate-task.js'
export * from './compat.js'
```

（原语句的具体换行格式以文件现状为准，整条替换。）

- [ ] **Step 7: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests/delegate-task.test.ts`
Expected: typecheck 通过；测试 PASS。

- [ ] **Step 8: 批次三全量验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过（bridge 经 compat 拿到 `DelegateTaskInputV2` 类型，零改动）。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(core): migrate todo/sub-agent into capabilities, drop v2 naming behind compat"
```

---

### Task 9: 批次四 — runtime 迁移

**Files:**
- Create: `packages/core/scripts/governance-mappings/batch4-runtime.json`
- Move: `assemble-pi-agent.ts`、`pi-agent-like.ts`、`run-agent/*`（3 个）→ `runtime/`；`reason/generate.ts` → `runtime/generation/generate.ts`

- [ ] **Step 1: 写 mapping**

创建 `packages/core/scripts/governance-mappings/batch4-runtime.json`：

```json
{
  "assemble-pi-agent.ts": "runtime/assemble-pi-agent.ts",
  "run-agent/context-bridge.ts": "runtime/context-bridge.ts",
  "run-agent/pi-agent-factory.ts": "runtime/pi-agent-factory.ts",
  "run-agent/tool-bridge.ts": "runtime/tool-bridge.ts",
  "pi-agent-like.ts": "runtime/pi-agent-like.ts",
  "reason/generate.ts": "runtime/generation/generate.ts"
}
```

- [ ] **Step 2: git mv**

```bash
mkdir -p packages/core/src/runtime/generation
git mv packages/core/src/assemble-pi-agent.ts packages/core/src/pi-agent-like.ts packages/core/src/runtime/
git mv packages/core/src/run-agent/context-bridge.ts packages/core/src/run-agent/pi-agent-factory.ts packages/core/src/run-agent/tool-bridge.ts packages/core/src/runtime/
git mv packages/core/src/reason/generate.ts packages/core/src/runtime/generation/generate.ts
```

- [ ] **Step 3: 跑 codemod**

```bash
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/batch4-runtime.json
```

Expected: 无"未能解析"警告。

- [ ] **Step 4: 批次四全量验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core): consolidate pi-agent adaptation boundary into runtime/"
```

---

### Task 10: 批次五 — agent 基础文件迁移（types / budget / token-usage / bus / 事件 / 流聚合）

**Files:**
- Create: `packages/core/scripts/governance-mappings/batch5-agent-base.json`
- Move: 根目录 `types.ts`、`budget.ts`、`token-usage.ts`、`bus-events.ts`、`broadcast-bus.ts`、`event-queue.ts` → `agent/`；`rem-agent-event.ts` → `agent/agent-event.ts`；`stream/event-aggregators.ts` → `agent/event-aggregators.ts`
- Modify: `packages/core/package.json:12-19`（两个 exports subpath target）
- Modify: `vitest.config.ts:16-17`（两条 alias）

- [ ] **Step 1: 写 mapping**

创建 `packages/core/scripts/governance-mappings/batch5-agent-base.json`：

```json
{
  "types.ts": "agent/types.ts",
  "budget.ts": "agent/budget.ts",
  "token-usage.ts": "agent/token-usage.ts",
  "bus-events.ts": "agent/bus-events.ts",
  "broadcast-bus.ts": "agent/broadcast-bus.ts",
  "event-queue.ts": "agent/event-queue.ts",
  "rem-agent-event.ts": "agent/agent-event.ts",
  "stream/event-aggregators.ts": "agent/event-aggregators.ts"
}
```

- [ ] **Step 2: git mv**

```bash
mkdir -p packages/core/src/agent
git mv packages/core/src/types.ts packages/core/src/budget.ts packages/core/src/token-usage.ts packages/core/src/bus-events.ts packages/core/src/broadcast-bus.ts packages/core/src/event-queue.ts packages/core/src/agent/
git mv packages/core/src/rem-agent-event.ts packages/core/src/agent/agent-event.ts
git mv packages/core/src/stream/event-aggregators.ts packages/core/src/agent/event-aggregators.ts
```

- [ ] **Step 3: 跑 codemod**

```bash
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/batch5-agent-base.json
```

Expected: 无"未能解析"警告。

- [ ] **Step 4: 改 package.json exports target（key 不变）**

把：

```json
    "./stream/event-aggregators": {
      "import": "./dist/stream/event-aggregators.js",
      "types": "./dist/stream/event-aggregators.d.ts"
    },
    "./token-usage": {
      "import": "./dist/token-usage.js",
      "types": "./dist/token-usage.d.ts"
    },
```

改为：

```json
    "./stream/event-aggregators": {
      "import": "./dist/agent/event-aggregators.js",
      "types": "./dist/agent/event-aggregators.d.ts"
    },
    "./token-usage": {
      "import": "./dist/agent/token-usage.js",
      "types": "./dist/agent/token-usage.d.ts"
    },
```

- [ ] **Step 5: 改根 vitest.config.ts alias**

把第 16-17 行：

```ts
      { find: 'rem-agent-core/stream/event-aggregators', replacement: resolve(__dirname, 'packages/core/src/stream/event-aggregators.ts') },
      { find: 'rem-agent-core/token-usage', replacement: resolve(__dirname, 'packages/core/src/token-usage.ts') },
```

改为：

```ts
      { find: 'rem-agent-core/stream/event-aggregators', replacement: resolve(__dirname, 'packages/core/src/agent/event-aggregators.ts') },
      { find: 'rem-agent-core/token-usage', replacement: resolve(__dirname, 'packages/core/src/agent/token-usage.ts') },
```

- [ ] **Step 6: 验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过（`stream/` 目录已清空消失）。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move agent domain base files into agent/"
```

---

### Task 11: 批次五 — REMAgent 拆分 + agent/context 拆分

`rem-agent.ts`（217 行）拆为 4 个文件：生命周期编排（rem-agent.ts）、单次运行状态与事件归并（agent-run-state.ts）、输出构造（agent-output.ts）、标题生成（session-title.ts）。`agent-context.ts`（78 行）拆为 types + resolve，工具清单组装下沉到 `tools/prompt-tool-summary.ts`（否则 agent/ 会直接 import plugins/，违反依赖规则）。

现有测试 `tests/rem-agent.test.ts`、`tests/rem-agent-assembly.test.ts` 就是行为刻画：拆分前后都必须通过，且不修改测试内容（codemod 只改它们的 import 路径）。

**Files:**
- Create: `packages/core/scripts/governance-mappings/batch5-agent-core.json`
- Move: `rem-agent.ts` → `agent/rem-agent.ts`；`agent-context.ts` → `agent/context/resolve.ts`
- Create: `packages/core/src/agent/agent-output.ts`、`agent-run-state.ts`、`session-title.ts`、`context/types.ts`
- Create: `packages/core/src/tools/prompt-tool-summary.ts`
- Modify: `packages/core/src/agent/rem-agent.ts`、`agent/context/resolve.ts`（重写）

**路径接力说明**：assembly 目录在 Task 12 才迁移，本 Task 新建文件中对 `AgentDI`/`AgentRuntimeConfig` 的引用一律写**当前路径**（`../agent-di.js`、`../agent-runtime-config.js`，context/ 下为 `../../`），Task 12 的 codemod 会自动改成 `assembly/` 下的最终路径。

- [ ] **Step 1: 写 mapping**

创建 `packages/core/scripts/governance-mappings/batch5-agent-core.json`：

```json
{
  "rem-agent.ts": "agent/rem-agent.ts",
  "agent-context.ts": "agent/context/resolve.ts"
}
```

- [ ] **Step 2: git mv + 跑 codemod**

```bash
mkdir -p packages/core/src/agent/context
git mv packages/core/src/rem-agent.ts packages/core/src/agent/rem-agent.ts
git mv packages/core/src/agent-context.ts packages/core/src/agent/context/resolve.ts
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/batch5-agent-core.json
```

Expected: 无"未能解析"警告。

- [ ] **Step 3: 确认基线（拆分前，纯移动状态）**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests/rem-agent.test.ts packages/core/tests/rem-agent-assembly.test.ts`
Expected: 全部 PASS。这是拆分前的行为基线。

- [ ] **Step 4: 创建 agent/agent-output.ts**

```ts
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentOutput } from './types.js';

/** 从最终 Assistant 消息构造输出；stopReason=error 时构造 'Error: ...' 输出 */
export function buildAgentOutput(lastAssistant: AssistantMessage | undefined): AgentOutput {
  if (lastAssistant?.stopReason === 'error') {
    const errorMessage = lastAssistant.errorMessage ?? 'agent stream error';
    return { content: `Error: ${errorMessage}`, completed: true };
  }
  const content =
    lastAssistant?.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('') ?? '';
  return { content, completed: true };
}

/** 从异常构造 'Error: ...' 输出（run 捕获路径） */
export function buildAgentErrorOutput(error: unknown): AgentOutput {
  const message = error instanceof Error ? error.message : String(error);
  return { content: `Error: ${message}`, completed: true };
}

/** 从 'Error: ...' 输出取回错误消息（用于 error 事件，保持原事件结构） */
export function agentOutputErrorMessage(output: AgentOutput): string {
  return output.content.slice('Error: '.length);
}
```

- [ ] **Step 5: 创建 agent/agent-run-state.ts**

```ts
import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AgentOutput, RemMetaEvent } from './types.js';
import { addUsage, emptyUsage } from './token-usage.js';
import { generateId } from '../shared/generate-id.js';
import { EventQueue } from './event-queue.js';
import type { REMAgentEvent } from './agent-event.js';
import { agentOutputErrorMessage, buildAgentErrorOutput, buildAgentOutput } from './agent-output.js';

/** 单次 run 的可变状态与事件归并（REMAgent 每次 run 创建一个实例） */
export class AgentRunState {
  readonly queue = new EventQueue<REMAgentEvent>();
  readonly outputPromise: Promise<AgentOutput>;
  private outputResolve?: (output: AgentOutput) => void;
  private totalUsage: Usage = emptyUsage();
  private lastAssistant?: AssistantMessage;
  private lastAssistantMessageId?: string;

  /** run 前缓冲的 meta 事件（如标题）按序 flush 进新队列 */
  constructor(pendingMeta: RemMetaEvent[]) {
    for (const event of pendingMeta) this.queue.push(event);
    this.outputPromise = new Promise<AgentOutput>((resolve) => {
      this.outputResolve = resolve;
    });
  }

  /** pi Agent 事件归并：透传原事件，message_end 追加 message-persist，turn_end 累计 usage */
  ingest(event: AgentEvent): void {
    this.queue.push(event);
    if (event.type === 'message_end') {
      const message = event.message as Message;
      const messageId = generateId();
      if (message.role === 'assistant') {
        this.lastAssistantMessageId = messageId;
      }
      this.queue.push({ type: 'message-persist', message, messageId });
    } else if (event.type === 'turn_end' && (event.message as Message).role === 'assistant') {
      this.lastAssistant = event.message as AssistantMessage;
      this.totalUsage = addUsage(this.totalUsage, this.lastAssistant.usage);
    }
  }

  /** 正常收尾：usage 事件 + finish/error 事件 + resolve output；返回终态 */
  complete(): 'finished' | 'error' {
    this.queue.push({ type: 'usage', usage: this.totalUsage, assistantMessageId: this.lastAssistantMessageId });
    const output = buildAgentOutput(this.lastAssistant);
    if (this.lastAssistant?.stopReason === 'error') {
      this.queue.push({ type: 'error', error: { name: 'AgentError', message: agentOutputErrorMessage(output) } });
      this.outputResolve?.(output);
      return 'error';
    }
    this.queue.push({ type: 'finish', output });
    this.outputResolve?.(output);
    return 'finished';
  }

  /** 异常收尾：error 事件 + resolve 'Error: ...' 输出 */
  fail(error: unknown): void {
    const output = buildAgentErrorOutput(error);
    this.queue.push({ type: 'error', error: { name: 'AgentError', message: agentOutputErrorMessage(output) } });
    this.outputResolve?.(output);
  }

  finish(): void {
    this.queue.finish();
  }
}
```

- [ ] **Step 6: 创建 agent/session-title.ts**

```ts
import type { AgentDI } from '../agent-di.js';
import type { Session } from '../session/model.js';
import type { RemMetaEvent } from './types.js';
import { log } from '../infrastructure/observability/debug-log.js';

/**
 * 会话标题生成：异步触发，经 emit 发出 session-title meta 事件，由上层 SessionService 落盘。
 * 由 REMAgent 构造函数作为协作编排调用；不在此处自行启动之外的副作用。
 */
export function forkSessionTitleGeneration(params: {
  di: AgentDI;
  session: Session;
  emit: (event: RemMetaEvent) => void;
}): void {
  const { di, session, emit } = params;
  if (session.metadata.title) return;
  void (async () => {
    try {
      const title = await di.titleProvider.generateTitle(session.conversation);
      if (title) {
        log('title', 'generated', { sessionId: session.sessionId, title });
        emit({ type: 'session-title', title });
      }
    } catch {
      log('title', 'failed', { sessionId: session.sessionId });
    }
  })();
}
```

- [ ] **Step 7: 创建 tools/prompt-tool-summary.ts**

```ts
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { ToolInfo } from '../sdk/system-prompt.js';
import { composeToolProviders } from './composer.js';
import { createTodoWriteToolDefinition } from '../plugins/tool/builtin/todo-write.js';
import { createDelegateTaskToolDefinition } from '../capabilities/sub-agent/delegate-task.js';

/** systemPrompt 的工具清单：composed providers + delegate_task/todo_write 两个内建工具（无需真建 overlay） */
export function listPromptToolSummaries(params: {
  toolProvider: ToolProvider;
  mcpProviders: ToolProvider[];
  skillProvider: SkillProvider;
}): ToolInfo[] {
  const composed = composeToolProviders(params);
  const delegateDef = createDelegateTaskToolDefinition();
  const todoDef = createTodoWriteToolDefinition();
  return [
    ...composed.getToolSet().map((t) => ({ name: t.name, description: t.description ?? '' })),
    { name: delegateDef.name, description: delegateDef.description },
    { name: todoDef.name, description: todoDef.description },
  ];
}
```

- [ ] **Step 8: 创建 agent/context/types.ts**

```ts
import type { Message } from '@earendil-works/pi-ai';
import type { AgentDI } from '../../agent-di.js';
import type { AgentRuntimeConfig } from '../../agent-runtime-config.js';
import type { Session } from '../../session/model.js';
import type { AgentBehaviorConfig, ConfigProvider, ResolvedModelConfig } from '../../sdk/config-provider.js';

/** REMAgent 构造所需的全部预解析产物（异步部分在此收敛，构造函数保持同步） */
export interface REMAgentContext {
  messages: Message[];
  systemPrompt: string;
  effectiveModel: ResolvedModelConfig;
  behavior: Required<AgentBehaviorConfig>;
  configProvider: ConfigProvider;
  workspaceRoot: string;
}

export interface ResolveREMAgentContextParams {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  /** 已由 SessionService 加载/创建的 session */
  session: Session;
  workspace: string;
  agentRoleId?: string;
  workspaceRoot?: string;
}
```

- [ ] **Step 9: 重写 agent/context/resolve.ts**

把 `packages/core/src/agent/context/resolve.ts`（git mv 过来的旧 agent-context.ts）整体替换为：

```ts
import type { Skill } from '../../sdk/skill-provider.js';
import type { PromptBuildContext } from '../../sdk/system-prompt.js';
import { listPromptToolSummaries } from '../../tools/prompt-tool-summary.js';
import type { REMAgentContext, ResolveREMAgentContextParams } from './types.js';

export type { REMAgentContext, ResolveREMAgentContextParams } from './types.js';

export async function resolveREMAgentContext(params: ResolveREMAgentContextParams): Promise<REMAgentContext> {
  const { di, runtimeConfig, session, workspace } = params;
  const configProvider = di.configProvider.forWorkspace?.(workspace) ?? di.configProvider;
  const behavior = configProvider.getBehaviorConfig();
  const modelConfig = configProvider.getModelConfig();
  const agentRole = configProvider.resolveAgent(params.agentRoleId);
  const effectiveModel = agentRole.model ?? modelConfig;
  const workspaceRoot = params.workspaceRoot ?? workspace ?? behavior.workspaceRoot;

  const [{ messages }, skills] = await Promise.all([
    di.contextProvider.build(session, behavior.name),
    di.skillProvider.loadSkills().catch(() => [] as Skill[]),
  ]);

  const tools = listPromptToolSummaries({
    toolProvider: di.toolProvider,
    mcpProviders: di.mcpProviders,
    skillProvider: di.skillProvider,
  });

  const buildCtx: PromptBuildContext = {
    agentName: agentRole.name,
    workspaceRoot,
    readOnly: behavior.readOnly,
    tools,
    skills,
    model: { provider: effectiveModel.provider, model: effectiveModel.model },
    runtime: {
      platform: runtimeConfig.runtime.platform,
      nodeVersion: runtimeConfig.runtime.nodeVersion ?? runtimeConfig.runtime.platform,
      today: new Date().toISOString().split('T')[0],
    },
    agentCorePrompt: agentRole.corePrompt,
  };

  const systemPrompt = await di.systemPromptAssembler.assemble(buildCtx);

  return { messages, systemPrompt, effectiveModel, behavior, configProvider, workspaceRoot };
}
```

- [ ] **Step 10: 重写 agent/rem-agent.ts**

把 `packages/core/src/agent/rem-agent.ts` 整体替换为：

```ts
import type { Message } from '@earendil-works/pi-ai';
import type { AgentDI } from '../agent-di.js';
import type { AgentRuntimeConfig } from '../agent-runtime-config.js';
import type { BusEvent } from './bus-events.js';
import type { Session } from '../session/model.js';
import type { AgentOutput, RemMetaEvent, UserInput, UserInputContent } from './types.js';
import type { ApprovalRequest } from '../sdk/agent-state-provider.js';
import type { ApprovalEngine } from '../security/approval/approval-engine.js';
import type { PiAgentLike } from '../runtime/pi-agent-like.js';
import type { REMAgentEvent } from './agent-event.js';
import type { REMAgentContext } from './context/types.js';
import { assemblePiAgent } from '../runtime/assemble-pi-agent.js';
import type { SpawnChild } from '../capabilities/sub-agent/delegate-task.js';
import { AgentRunState } from './agent-run-state.js';
import { forkSessionTitleGeneration } from './session-title.js';

export type REMAgentStatus = 'idle' | 'running' | 'finished' | 'error';

const toMessage = (content: UserInputContent): Message =>
  ({ role: 'user', content, timestamp: Date.now() }) as Message;

/** tool-bridge 审批链路需要的最小 live state 面（由 bridge 的 REMSession 满足） */
export interface ApprovalStateLike {
  approvalEngine: ApprovalEngine;
  pendingApprovals: ApprovalRequest[];
}

export interface REMAgentParams {
  agentId: string;
  /** 所属持久化 session（子 Agent 有自己的 sessionId） */
  sessionId?: string;
  /** delegate_task 的 task 摘要（用于 child-agent-update） */
  summary?: string;
  /** 测试注入：跳过内部装配直接使用该 pi agent */
  agent?: PiAgentLike;
  /** 以下参数在 agent 缺省时必填；context 由 resolveREMAgentContext 预解析 */
  context?: REMAgentContext;
  di?: AgentDI;
  runtimeConfig?: AgentRuntimeConfig;
  session?: Session;
  workspace?: string;
  signal?: AbortSignal;
  approvalState?: { getOrCreate(sessionId: string): ApprovalStateLike };
  publishBus?: (event: BusEvent) => void;
  spawnChild?: SpawnChild;
}

/**
 * 无状态执行单元 + 事件源：负责公开生命周期操作与协作编排。
 * 单次 run 的可变状态与事件归并由 AgentRunState 持有；
 * 输出构造在 agent-output.ts；标题生成触发在 session-title.ts。
 */
export class REMAgent {
  readonly agentId: string;
  readonly sessionId?: string;
  readonly summary?: string;
  readonly children: REMAgent[] = [];
  status: REMAgentStatus = 'idle';
  /** 由父 Agent attachChild 时回填 */
  parentToolCallId?: string;

  private readonly agent: PiAgentLike;
  private runState?: AgentRunState;
  private pendingMeta: RemMetaEvent[] = [];

  constructor(params: REMAgentParams) {
    this.agentId = params.agentId;
    this.sessionId = params.sessionId;
    this.summary = params.summary;
    if (params.agent) {
      this.agent = params.agent;
    } else {
      if (!params.context || !params.di || !params.runtimeConfig || !params.session ||
          !params.workspace || !params.approvalState || !params.publishBus) {
        throw new Error('REMAgent requires either an injected agent or full assembly params (context/di/runtimeConfig/session/workspace/approvalState/publishBus)');
      }
      this.agent = assemblePiAgent({
        di: params.di,
        runtimeConfig: params.runtimeConfig,
        context: params.context,
        session: params.session,
        sessionId: params.sessionId ?? params.session.sessionId,
        workspace: params.workspace,
        signal: params.signal,
        approvalState: params.approvalState,
        publishBus: params.publishBus,
        spawnChild: params.spawnChild,
        parent: this,
        emitMeta: (event) => this.emitMeta(event),
      });
      forkSessionTitleGeneration({
        di: params.di,
        session: params.session,
        emit: (event) => this.emitMeta(event),
      });
    }
  }

  /** 当前 run 的事件流（多消费者）；未运行时为 undefined */
  get events(): AsyncIterable<REMAgentEvent> | undefined {
    return this.runState?.queue;
  }

  /** 当前 run 的最终输出 */
  get output(): Promise<AgentOutput> | undefined {
    return this.runState?.outputPromise;
  }

  run(input: UserInput): AsyncIterable<REMAgentEvent> {
    if (this.status === 'running') {
      throw new Error(`REMAgent "${this.agentId}" is already running`);
    }
    this.status = 'running';
    const state = new AgentRunState(this.pendingMeta);
    this.pendingMeta = [];
    this.runState = state;

    this.agent.subscribe((event) => state.ingest(event));

    void (async () => {
      try {
        await this.agent.prompt(toMessage(input.content));
        this.status = state.complete();
      } catch (error) {
        state.fail(error);
        this.status = 'error';
      } finally {
        state.finish();
      }
    })();

    return state.queue;
  }

  steer(content: UserInputContent): void {
    this.agent.steer(toMessage(content));
  }

  followUp(content: UserInputContent): void {
    this.agent.followUp(toMessage(content));
  }

  interrupt(): void {
    this.agent.abort();
  }

  /** 内部：delegate_task executor 调用，把子 Agent 挂树并广播 child-spawned */
  attachChild(child: REMAgent, parentToolCallId: string): void {
    child.parentToolCallId = parentToolCallId;
    this.children.push(child);
    this.runState?.queue.push({ type: 'child-spawned', child, parentToolCallId });
  }

  /** 内部：装配注入的 meta 事件出口（tool-bridge / context-bridge / 标题） */
  emitMeta(event: RemMetaEvent): void {
    // run 前的 meta（如标题生成异步先完成）先缓冲，run 时按序 flush
    if (this.runState) {
      this.runState.queue.push(event);
    } else {
      this.pendingMeta.push(event);
    }
  }
}
```

- [ ] **Step 11: 验证（行为刻画测试必须原样通过）**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests/`
Expected: typecheck 通过；`rem-agent.test.ts`、`rem-agent-assembly.test.ts`、`delegate-task.test.ts`、`event-queue.test.ts` 等全部 PASS。

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(core): split REMAgent run state, output and title generation"
```

---

### Task 12: 批次五 — assembly 迁移 + 杂项归位 + 批次五收尾验证

`agent-context-builder.ts` 更名为 `agent-assembly.ts`（它是"默认组件构造 + 同步装配"），`agent-runtime-config.ts` 更名 `runtime-config.ts`。`AgentAssembly`/`AssembleAgentContextOptions` 两个接口从 assembler 抽到 `assembly/types.ts`（assembler re-export 保持兼容）。杂项：`agent-resolver.ts` → `plugins/config/default/`（唯一消费者，避免 plugins→assembly 违规），`utils/skill-parser.ts` → `plugins/skill/`（唯一消费者）。

**Files:**
- Create: `packages/core/scripts/governance-mappings/batch5-assembly.json`
- Move: `agent-factory.ts`、`agent-context-assembler.ts`、`agent-di.ts` → `assembly/`；`agent-context-builder.ts` → `assembly/agent-assembly.ts`；`agent-runtime-config.ts` → `assembly/runtime-config.ts`；`agent-resolver.ts` → `plugins/config/default/agent-resolver.ts`；`utils/skill-parser.ts` → `plugins/skill/skill-parser.ts`
- Create: `packages/core/src/assembly/types.ts`
- Modify: `packages/core/src/assembly/agent-context-assembler.ts`（删除两个接口，改为 re-export）

- [ ] **Step 1: 写 mapping**

创建 `packages/core/scripts/governance-mappings/batch5-assembly.json`：

```json
{
  "agent-factory.ts": "assembly/agent-factory.ts",
  "agent-context-builder.ts": "assembly/agent-assembly.ts",
  "agent-context-assembler.ts": "assembly/agent-context-assembler.ts",
  "agent-di.ts": "assembly/agent-di.ts",
  "agent-runtime-config.ts": "assembly/runtime-config.ts",
  "agent-resolver.ts": "plugins/config/default/agent-resolver.ts",
  "utils/skill-parser.ts": "plugins/skill/skill-parser.ts"
}
```

- [ ] **Step 2: git mv + 跑 codemod**

```bash
mkdir -p packages/core/src/assembly
git mv packages/core/src/agent-factory.ts packages/core/src/agent-context-assembler.ts packages/core/src/agent-di.ts packages/core/src/assembly/
git mv packages/core/src/agent-context-builder.ts packages/core/src/assembly/agent-assembly.ts
git mv packages/core/src/agent-runtime-config.ts packages/core/src/assembly/runtime-config.ts
git mv packages/core/src/agent-resolver.ts packages/core/src/plugins/config/default/agent-resolver.ts
git mv packages/core/src/utils/skill-parser.ts packages/core/src/plugins/skill/skill-parser.ts
node packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/batch5-assembly.json
```

Expected: 无"未能解析"警告。

- [ ] **Step 3: 基线验证（纯移动状态）**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: 通过。

- [ ] **Step 4: 创建 assembly/types.ts**

```ts
import type { Models } from '@earendil-works/pi-ai';
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig, AgentRuntimeInfo } from './runtime-config.js';
import type { ConfigProvider } from '../sdk/config-provider.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { ContextProvider } from '../sdk/context-provider.js';
import type { SkillProvider } from '../sdk/skill-provider.js';
import type { BudgetPolicy } from '../sdk/budget-policy.js';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { ErrorHandler } from '../sdk/error-handler.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import type { SystemPromptAssembler } from '../sdk/system-prompt.js';
import type { StorageProvider } from '../sdk/storage-provider.js';
import type { McpConnectionManager } from '../infrastructure/mcp/connection-manager.js';
import type { SecurityMode } from '../security/permissions/factory.js';

export interface AgentAssembly {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
}

export interface AssembleAgentContextOptions {
  configProvider: ConfigProvider;
  /** 缺省时由 storage.sessionStore 装配 DefaultSessionProvider。 */
  sessionProvider?: SessionProvider;
  storageProvider: StorageProvider;
  systemPromptAssembler: SystemPromptAssembler;
  models: Models;
  runtime: AgentRuntimeInfo;
  /** 仅 Node 路径使用；浏览器可省略（runAgent 不触碰）。 */
  mcpManager?: McpConnectionManager;
  toolProvider?: ToolProvider;
  mcpProviders?: ToolProvider[];
  skillProvider?: SkillProvider;
  contextProvider?: ContextProvider;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  errorHandler?: ErrorHandler;
  titleProvider?: TitleProvider;
  securityMode?: SecurityMode;
}
```

- [ ] **Step 5: 精简 agent-context-assembler.ts**

在 `packages/core/src/assembly/agent-context-assembler.ts` 中：
1. 删除 `export interface AgentAssembly { ... }` 和 `export interface AssembleAgentContextOptions { ... }` 两个接口定义（约第 30-54 行，已被 Step 2 codemod 修正过 import 的版本）。
2. 在文件顶部 import 区加入：

```ts
import type { AgentAssembly, AssembleAgentContextOptions } from './types.js';
```

3. 紧接着加入 re-export（保持 index.ts 与既有引用不断）：

```ts
export type { AgentAssembly, AssembleAgentContextOptions } from './types.js';
```

4. 运行 `pnpm --filter rem-agent-core typecheck`。若报 unused import 错误（core tsconfig 开了 noUnusedLocals 才会报），逐个删除被标记的 import 行；若不报错则保留现状即可。注意：`AgentDI`、`SecurityMode`、`Rule`、`ConfigProvider` 仍被函数体使用（`buildConfigRules`/`initializeAgentDI` 等），不要删。

- [ ] **Step 6: 批次五全量验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过。

- [ ] **Step 7: 确认 src 根目录只剩出口文件**

Run: `ls packages/core/src/*.ts`
Expected: 只有 `compat.ts` 和 `index.ts` 两个文件。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(core): move composition root into assembly/, rehome resolver and skill parser"
```

---

### Task 13: 批次六 — index.ts 三段式公共出口

根入口重组为"稳定 API / 高级 API / 临时兼容 API"三段。导出符号集合与现状完全一致（compat 的 V2 别名已在 Task 8 就位），只重排与补注释。

**Files:**
- Modify: `packages/core/src/index.ts`（整体重写）

- [ ] **Step 1: 重写 index.ts**

把 `packages/core/src/index.ts` 整体替换为：

```ts
// ═══ 稳定 API：Agent 工厂、Agent/Session 核心类型、SDK 接口、装配入口 ═══
export * from './agent/types.js'
export type { Message, TextContent, ImageContent, ThinkingContent, ToolCall, Usage, AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'
export type { AgentEvent } from '@earendil-works/pi-agent-core'
export * from './session/model.js'
export * from './sdk/index.js'
export * from './plugins/index.js'
export { createAgentFromEnv, type CreateAgentOptions } from './assembly/agent-factory.js'
export { createAgentAssembly, type AgentContextBuildOptions } from './assembly/agent-assembly.js'
export type { AgentDI } from './assembly/agent-di.js'
export type { AgentRuntimeConfig, AgentRuntimeInfo } from './assembly/runtime-config.js'
export type { AgentAssembly } from './assembly/types.js'
export { initRuleEngine, initializeAgentDI } from './assembly/agent-context-assembler.js'
export { REMAgent, type REMAgentStatus, type REMAgentParams, type ApprovalStateLike } from './agent/rem-agent.js'
export type { REMAgentEvent } from './agent/agent-event.js'
export { resolveREMAgentContext } from './agent/context/resolve.js'
export type { REMAgentContext, ResolveREMAgentContextParams } from './agent/context/types.js'
export * from './agent/bus-events.js'
export * from './agent/broadcast-bus.js'
export * from './agent/budget.js'
export * from './agent/token-usage.js'
export * from './agent/event-aggregators.js'
export * from './session/manager/index.js'
export * from './capabilities/todo/types.js'
export * from './capabilities/todo/errors.js'
export * from './capabilities/todo/service.js'
export * from './infrastructure/config/paths.js'
export * from './infrastructure/observability/debug-log.js'
export { createCoreModels, type CreateCoreModelsOptions } from './infrastructure/llm/models.js'
export * from './infrastructure/llm/context-window.js'
export { generateId } from './shared/generate-id.js'

// ═══ 高级 API：工具编排、安全规则、运行时桥接 ═══
export * from './tools/registry.js'
export { composeToolProviders } from './tools/composer.js'
export { ToolOverlay, defineOverlayTool, type ToolOverlayEntry } from './tools/overlay.js'
export type { Rule, RuleAction, RuleSource } from './security/rules/rule.js'
export type { ToolProfileId } from './security/rules/profiles.js'
export { RuleEngine } from './security/rules/rule-engine.js'
export { RuleStore } from './security/rules/rule-store.js'
export { getProfileRules } from './security/rules/profiles.js'
export { classifyCommand } from './security/permissions/exec-classifier.js'
export { ApprovalEngine, type ApprovalResolution } from './security/approval/approval-engine.js'
export { createToolBridge, type ToolBridgeParams, type ToolBridge } from './runtime/tool-bridge.js'
export { createContextBridge, type ContextBridgeParams, type ContextBridge } from './runtime/context-bridge.js'
export { createPiAgent, type PiAgentFactoryParams } from './runtime/pi-agent-factory.js'
export type { PiAgentLike } from './runtime/pi-agent-like.js'
export { EventQueue } from './agent/event-queue.js'
export { createTodoWriteToolDefinition, createTodoWriteToolExecutor } from './plugins/tool/builtin/todo-write.js'
export { buildChildContext, type BuildChildContextOptions } from './capabilities/sub-agent/build-child-context.js'
export { formatTaskResult } from './capabilities/sub-agent/format-task-result.js'
export { createDelegateTaskExecutor, createDelegateTaskToolDefinition, type DelegateTaskExecutorParams, type DelegateTaskInput, type SpawnChild } from './capabilities/sub-agent/delegate-task.js'
export type { PromptBuildContext } from './sdk/system-prompt.js'

// ═══ 临时兼容 API：见 compat.ts 的删除条件 ═══
export * from './compat.js'
```

- [ ] **Step 2: 批次全量验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过（导出符号集合不变，外部包零改动）。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(core): reorganize root entry into stable/advanced/compat export tiers"
```

---

### Task 14: 批次六 — 结构检查脚本固化

把规格第 7 节的硬约束和第 11 节的结构检查落成可执行脚本，接入 package.json script。

**Files:**
- Create: `packages/core/scripts/check-structure.mjs`
- Modify: `packages/core/package.json`（scripts 增加 check-structure）

- [ ] **Step 1: 写结构检查脚本**

创建 `packages/core/scripts/check-structure.mjs`：

```js
#!/usr/bin/env node
// packages/core 结构检查：依赖方向、文件行数上限、kebab-case、.js 扩展名、compat 出口收敛。
// 用法: node packages/core/scripts/check-structure.mjs（任意目录下可运行）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const DOMAINS = ['agent', 'assembly', 'runtime', 'session', 'tools', 'security', 'capabilities', 'sdk', 'plugins', 'infrastructure', 'system-prompt', 'shared'];

// 规格第 7 节硬约束（只列禁止边；未列出的边不限制）
const FORBIDDEN = [
  ['sdk', ['plugins', 'assembly']],
  ['agent', ['plugins']],
  ['shared', DOMAINS.filter((d) => d !== 'shared')],
  ['plugins', ['assembly']],
];

const ENTRY_MAX_LINES = 120; // index.ts 等入口/聚合文件
const IMPL_MAX_LINES = 200;  // 实现文件

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.ts')) files.push(p);
  }
};
walk(srcRoot);

const domainOf = (abs) => {
  const rel = relative(srcRoot, abs);
  const first = rel.split(sep)[0];
  return DOMAINS.includes(first) ? first : '(root)';
};

const errors = [];
const importRe = /(?:from|import\s*\()\s*['"](\.[^'"]+)['"]/g;

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const rel = relative(srcRoot, file);
  const base = file.split(sep).pop();

  // kebab-case
  if (!/^[a-z0-9.-]+\.ts$/.test(base)) {
    errors.push(`${rel}: 文件名必须 kebab-case`);
  }

  // 行数上限（.d.ts 豁免）
  if (!base.endsWith('.d.ts')) {
    const lines = content.split('\n').length;
    const max = base === 'index.ts' ? ENTRY_MAX_LINES : IMPL_MAX_LINES;
    if (lines > max) {
      errors.push(`${rel}: ${lines} 行，超过上限 ${max}`);
    }
  }

  // 依赖方向 + .js 扩展名
  const fromDomain = domainOf(file);
  for (const m of content.matchAll(importRe)) {
    const spec = m[1];
    if (!spec.endsWith('.js')) {
      errors.push(`${rel}: 相对导入缺少 .js 扩展名 → ${spec}`);
      continue;
    }
    const targetAbs = join(dirname(file), spec.replace(/\.js$/, '.ts'));
    const toDomain = domainOf(targetAbs);
    for (const [from, tos] of FORBIDDEN) {
      if (fromDomain === from && tos.includes(toDomain)) {
        errors.push(`${rel}: 禁止 ${from} → ${toDomain}（${spec}）`);
      }
    }
  }

  // runtime/ 不得读取环境配置
  if (fromDomain === 'runtime' && /process\.env/.test(content)) {
    errors.push(`${rel}: runtime/ 不得读取 process.env`);
  }

  // V2 兼容导出只能集中在 compat.ts
  if (base !== 'compat.ts' && /export\s+(type\s+)?\{[^}]*\b\w*V2\w*\b/.test(content)) {
    errors.push(`${rel}: V2 兼容导出只能集中在 compat.ts`);
  }
}

if (errors.length) {
  console.error(`结构检查失败（${errors.length} 项）：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`结构检查通过（${files.length} 个文件）`);
```

- [ ] **Step 2: 接入 package.json script**

`packages/core/package.json` 的 `scripts` 改为：

```json
  "scripts": {
    "build": "node scripts/generate-templates.mjs && tsc",
    "typecheck": "tsc --noEmit",
    "check-structure": "node scripts/check-structure.mjs"
  },
```

- [ ] **Step 3: 运行结构检查**

Run: `pnpm --filter rem-agent-core check-structure`
Expected: 输出 `结构检查通过（N 个文件）`，退出码 0。

如果报错，常见情况与处理：
- `agent → plugins`：检查是否遗漏了 Task 11 Step 7（工具清单必须经 `tools/prompt-tool-summary.ts` 中转）。
- 行数超限：确认 Task 5/6/7/11 的拆分都已落地。
- 未列出过的其他违规：不要放宽规则，回到对应 Task 检查落位。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(core): enforce module dependency rules with structure checker"
```

---

### Task 15: 批次六 — 文档同步与临时工具清理

修正文档与代码的漂移（含规格点名的 `session-writer.ts` 幽灵引用），删除一次性 codemod，最终验证。

**Files:**
- Modify: `docs/architecture.md:88-92`、`:318-319`
- Modify: `docs/module-reference.md:33`
- Modify: `AGENTS.md`（常用入口表 + 红线 3 的路径引用）
- Delete: `packages/core/scripts/rewrite-imports.mjs`、`packages/core/scripts/governance-mappings/`

- [ ] **Step 1: 修 docs/architecture.md 执行链路描述**

把第 88-92 行：

```text
│  │  run-agent/pi-agent-factory.ts 装配 Agent；                        │   │
│  │  run-agent/tool-bridge.ts     → 工具执行 + 审批管线                │   │
│  │  run-agent/context-bridge.ts  → 上下文压缩（transformContext）     │   │
│  │  run-agent/session-writer.ts  → 消息持久化                         │   │
│  │  reason/generate.ts → models.complete（标题/压缩等非流式生成）     │   │
```

替换为：

```text
│  │  runtime/pi-agent-factory.ts 装配 Agent；                          │   │
│  │  runtime/tool-bridge.ts       → 工具执行 + 审批管线                │   │
│  │  runtime/context-bridge.ts    → 上下文压缩（transformContext）     │   │
│  │  消息持久化经 message-persist 事件由上层 SessionService 落盘        │   │
│  │  runtime/generation/generate.ts → models.complete（非流式生成）    │   │
```

- [ ] **Step 2: 修 docs/architecture.md 目录树**

把第 318-319 行：

```text
│   │       ├── run-agent.ts         无状态 runAgent()（唯一执行入口，facade）
│   │       ├── run-agent/           pi-agent-factory, tool-bridge, context-bridge, session-writer
```

替换为：

```text
│   │       ├── runtime/             assemble-pi-agent, pi-agent-factory, tool-bridge, context-bridge, generation/
```

- [ ] **Step 3: 修 docs/module-reference.md**

把第 33 行：

```text
| `run-agent.ts` + `run-agent/` | `runAgent()` — 无状态 Agent 运行，**唯一执行入口**；`run-agent/` 内含 pi-agent-factory（装配 pi-agent-core `Agent`）、tool-bridge（工具执行+审批管线）、context-bridge（上下文压缩）、session-writer（消息持久化），含并发标题生成 |
```

替换为：

```text
| `runtime/` | pi-agent 适配边界：assemble-pi-agent（REMAgent 内部装配入口）、pi-agent-factory（装配 pi-agent-core `Agent`）、tool-bridge（工具执行+审批管线）、context-bridge（上下文压缩）、generation/（`models.complete` 非流式生成）；消息持久化经 `message-persist` 事件交给上层 SessionService |
```

- [ ] **Step 4: 修 AGENTS.md 常用入口表与红线引用**

常用入口表中逐行替换（路径列更新，描述列微调保持一致）：

```text
| `packages/core/src/agent-factory.ts` | `createAgentFromEnv` |
```
→
```text
| `packages/core/src/assembly/agent-factory.ts` | `createAgentFromEnv` |
```

```text
| `packages/core/src/run-agent/index.ts` | `runAgent`：唯一执行入口（装配 pi-agent-core `Agent`） |
```
→
```text
| `packages/core/src/runtime/assemble-pi-agent.ts` | `assemblePiAgent`：装配 pi-agent-core `Agent`（REMAgent 内部执行入口） |
```

```text
| `packages/core/src/run-agent/pi-agent-factory.ts` | `createPiAgent`：pi-agent-core `Agent` 装配 |
```
→
```text
| `packages/core/src/runtime/pi-agent-factory.ts` | `createPiAgent`：pi-agent-core `Agent` 装配 |
```

```text
| `packages/core/src/reason/generate.ts` | `generate()`：使用 `models.complete` 执行非流式生成（标题/压缩摘要） |
```
→
```text
| `packages/core/src/runtime/generation/generate.ts` | `generate()`：使用 `models.complete` 执行非流式生成（标题/压缩摘要） |
```

```text
| `packages/core/src/llm/context-window.ts` | 上下文窗口大小解析 |
```
→
```text
| `packages/core/src/infrastructure/llm/context-window.ts` | 上下文窗口大小解析 |
```

```text
| `packages/core/src/agent-context-assembler.ts` | `assembleAgentContext`：纯装配函数，全部 provider 可注入 |
```
→
```text
| `packages/core/src/assembly/agent-context-assembler.ts` | `assembleAgentContext`：纯装配函数，全部 provider 可注入 |
```

```text
| `packages/core/src/agent-context-builder.ts` | `createAgentAssembly`（同步装配） |
```
→
```text
| `packages/core/src/assembly/agent-assembly.ts` | `createAgentAssembly`（同步装配） |
```

红线 3 中的句子 `core 在 \`run-agent/pi-agent-factory.ts\` 装配，经 tool-bridge / context-bridge / session-writer 桥接` 改为 `core 在 \`runtime/pi-agent-factory.ts\` 装配，经 tool-bridge / context-bridge 桥接`（顺带删除 session-writer 幽灵引用）。

顺手清理根 vitest.config.ts 第 23 行已失效的 alias（tui 包不存在）——删除：

```ts
      { find: 'rem-agent-tui', replacement: resolve(__dirname, 'packages/tui/src/index.ts') },
```

- [ ] **Step 5: 删除一次性 codemod 与 mapping**

```bash
git rm packages/core/scripts/rewrite-imports.mjs packages/core/scripts/governance-mappings/smoke.json packages/core/scripts/governance-mappings/batch1-infrastructure.json packages/core/scripts/governance-mappings/batch2-session-tools.json packages/core/scripts/governance-mappings/batch2-security.json packages/core/scripts/governance-mappings/batch3-capabilities.json packages/core/scripts/governance-mappings/batch4-runtime.json packages/core/scripts/governance-mappings/batch5-agent-base.json packages/core/scripts/governance-mappings/batch5-agent-core.json packages/core/scripts/governance-mappings/batch5-assembly.json
```

- [ ] **Step 6: 最终全量验证**

Run: `pnpm typecheck && pnpm test && pnpm --filter rem-agent-core check-structure`
Expected: 三条命令全部通过。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: sync architecture docs with core module governance, drop one-off codemod"
```

---

## 完成标准核对（对应规格第 11 节）

- [ ] Core 目标目录落地（Task 2-12）
- [ ] 4 个超限文件完成拆分（Task 5/6/7/11）
- [ ] 公共出口完成分级（Task 8 的 compat.ts + Task 13 的 index.ts）
- [ ] 结构检查固化（Task 14）
- [ ] 文档与代码一致（Task 15）
- [ ] 全仓 typecheck + test 通过（每个批次收尾 + Task 15 最终验证）

## 执行注意事项

1. **不要跳批次**：每个批次的 mapping 都假设前一批次已完成（路径是接力解析的）。
2. **codemod 报警（exit code 2）时停下来人工检查**，不要继续往后跑。
3. 所有 `sed -i ''` 命令是 macOS 语法；若在 Linux 执行改为 `sed -i`。
4. 本计划不触碰 `bridge`/`routes`/`ui`/`web` 的任何 import——如果某批次后这些包 typecheck 失败，说明 root 导出符号或 subpath key 被破坏，回查该批次，不要改外部包。
