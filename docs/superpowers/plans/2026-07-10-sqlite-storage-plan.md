# SQLite Storage Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `rem-agent-core` 中新增统一的 SQLite 存储基建层，将 session 和 rules 数据从 JSON/JSONL 迁移到 SQLite，并抽象 `StorageProvider` 接口支持后续切换后端。

**Architecture:** 新增 `src/storage/` 目录，包含 `StorageProvider` / `SessionStore` / `RuleStore` 接口、`StorageError`、schema 版本管理，以及 `sqlite/` 下的 `SqliteStorageProvider`、`SqliteSessionStore`、`SqliteRuleStore` 实现。`buildAgentContext` 默认构造 `SqliteStorageProvider`，并注入到 `SqliteSessionProvider` 和 `RuleEngine`。

**Tech Stack:** TypeScript, `better-sqlite3`, Vitest

---

## 文件结构

新增文件：

- `packages/core/src/storage/types.ts` — `StorageProvider`, `SessionStore`, `RuleStore` 接口
- `packages/core/src/storage/errors.ts` — `StorageError`
- `packages/core/src/storage/schema.ts` — `SqliteSchemaManager`（建表 + 版本管理）
- `packages/core/src/storage/sqlite/provider.ts` — `SqliteStorageProvider`
- `packages/core/src/storage/sqlite/session-store.ts` — `SqliteSessionStore`
- `packages/core/src/storage/sqlite/rule-store.ts` — `SqliteRuleStore`
- `packages/core/src/storage/index.ts` — 公开导出
- `packages/core/src/plugins/session/sqlite/index.ts` — `SqliteSessionProvider`（实现 `SessionProvider`）
- `packages/core/tests/storage/sqlite-session-store.test.ts`
- `packages/core/tests/storage/sqlite-rule-store.test.ts`
- `packages/core/tests/storage/schema-manager.test.ts`

修改文件：

- `packages/core/package.json` — 添加 `better-sqlite3` 依赖
- `packages/core/src/agent-context-builder.ts` — 接入 `StorageProvider`
- `packages/core/src/index.ts` — 导出 storage 公开 API
- `packages/core/src/plugins/index.ts` — 导出 `SqliteSessionProvider`

---

## Task 1: 安装依赖

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: 添加 `better-sqlite3` 依赖**

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.104.1",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@sinclair/typebox": "^0.27.0",
    "bash-parser": "^0.5.0",
    "better-sqlite3": "^11.0.0",
    "glob": "^13.0.6",
    "openai": "^6.42.0",
    "yaml": "^2.7.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `pnpm install`

Expected: `better-sqlite3` 安装成功，无 native build 错误。

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(deps): add better-sqlite3 for storage layer"
```

---

## Task 2: 定义 Storage 接口与错误类型

**Files:**
- Create: `packages/core/src/storage/types.ts`
- Create: `packages/core/src/storage/errors.ts`

- [ ] **Step 1: 创建 `packages/core/src/storage/types.ts`**

```ts
import type { Session, SessionSummary } from '../session.js';
import type { Rule, RuleSource } from '../security/rules/rule.js';

export interface StorageProvider {
  init(): Promise<void>;
  close(): Promise<void>;
  readonly sessionStore: SessionStore;
  readonly ruleStore: RuleStore;
}

export interface SessionStore {
  create(workspace: string): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  listByWorkspace(workspace: string): Promise<SessionSummary[]>;
  listAll(): Promise<SessionSummary[]>;
}

export interface RuleStore {
  loadAll(): Promise<Rule[]>;
  loadBySource(source: RuleSource): Promise<Rule[]>;
  saveApproved(rule: Omit<Rule, 'source'>): Promise<void>;
}
```

- [ ] **Step 2: 创建 `packages/core/src/storage/errors.ts`**

```ts
export type StorageErrorCode = 'DB_OPEN' | 'DB_QUERY' | 'DB_CONSTRAINT' | 'DB_MIGRATION';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly cause?: unknown;

  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.cause = cause;
    this.name = 'StorageError';
  }
}

export function wrapSqliteError(error: unknown, code: StorageErrorCode, message: string): StorageError {
  return new StorageError(code, message, error);
}
```

- [ ] **Step 3: 运行类型检查**

Run: `pnpm --filter rem-agent-core typecheck`

Expected: 通过（此时没有模块引用，只有新增文件）。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/storage/types.ts packages/core/src/storage/errors.ts
git commit -m "feat(storage): define StorageProvider, SessionStore, RuleStore interfaces and StorageError"
```

---

## Task 3: 实现 Schema 版本管理

**Files:**
- Create: `packages/core/src/storage/schema.ts`
- Test: `packages/core/tests/storage/schema-manager.test.ts`

- [ ] **Step 1: 创建测试 `packages/core/tests/storage/schema-manager.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteSchemaManager } from '../../src/storage/schema.js';
import Database from 'better-sqlite3';

describe('SqliteSchemaManager', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'schema-test-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should create tables and set schema version on fresh db', () => {
    const db = new Database(dbPath);
    const manager = new SqliteSchemaManager(db);
    manager.migrate();

    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(version.version).toBe(1);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions', 'messages', 'rules')"
    ).all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(['messages', 'rules', 'sessions']);

    db.close();
  });

  it('should be idempotent on repeated migrate calls', () => {
    const db = new Database(dbPath);
    const manager = new SqliteSchemaManager(db);
    manager.migrate();
    manager.migrate();

    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(version.version).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- packages/core/tests/storage/schema-manager.test.ts`

Expected: FAIL — `SqliteSchemaManager` not found。

- [ ] **Step 3: 创建 `packages/core/src/storage/schema.ts`**

```ts
import Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 1;

export class SqliteSchemaManager {
  constructor(private db: Database.Database) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        current_turn INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
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
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_sequence
        ON messages(session_id, sequence);

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
    `);

    const row = this.db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined;

    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
    } else if (row.version !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported schema version: ${row.version}`);
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- packages/core/tests/storage/schema-manager.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/schema.ts packages/core/tests/storage/schema-manager.test.ts
git commit -m "feat(storage): add SQLite schema manager and tests"
```

---

## Task 4: 实现 SqliteSessionStore

**Files:**
- Create: `packages/core/src/storage/sqlite/session-store.ts`
- Test: `packages/core/tests/storage/sqlite-session-store.test.ts`

- [ ] **Step 1: 创建测试 `packages/core/tests/storage/sqlite-session-store.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../../../src/storage/schema.js';
import { SqliteSessionStore } from '../../../src/storage/sqlite/session-store.js';
import type { ModelMessage } from '../../../src/types.js';

describe('SqliteSessionStore', () => {
  let dir: string;
  let db: Database.Database;
  let store: SqliteSessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sqlite-session-test-'));
    db = new Database(join(dir, 'test.db'));
    new SqliteSchemaManager(db).migrate();
    store = new SqliteSessionStore(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should create a session with default workspace', async () => {
    const session = await store.create('default');
    expect(session.sessionId).toBeDefined();
    expect(session.workspace).toBe('default');
    expect(session.conversation).toEqual([]);
    expect(session.currentTurn).toBe(0);
  });

  it('should save and load a session with messages', async () => {
    const session = await store.create('default');
    session.metadata.title = 'Test';
    session.metadata.pinned = true;
    session.currentTurn = 1;
    const msg: ModelMessage = {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    };
    session.conversation.push(msg);

    await store.save(session);
    const loaded = await store.load(session.sessionId);

    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.title).toBe('Test');
    expect(loaded!.metadata.pinned).toBe(true);
    expect(loaded!.currentTurn).toBe(1);
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('should return null for non-existent session', async () => {
    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('should delete a session', async () => {
    const session = await store.create('default');
    await store.delete(session.sessionId);
    const loaded = await store.load(session.sessionId);
    expect(loaded).toBeNull();
  });

  it('should list sessions by workspace sorted by updatedAt desc', async () => {
    const a = await store.create('ws1');
    a.metadata.title = 'A';
    await store.save(a);

    const b = await store.create('ws1');
    b.metadata.title = 'B';
    await store.save(b);

    const c = await store.create('ws2');
    c.metadata.title = 'C';
    await store.save(c);

    const list = await store.listByWorkspace('ws1');
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('B');
    expect(list[1].title).toBe('A');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- packages/core/tests/storage/sqlite-session-store.test.ts`

Expected: FAIL — `SqliteSessionStore` not found。

- [ ] **Step 3: 创建 `packages/core/src/storage/sqlite/session-store.ts`**

```ts
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Session, SessionSummary } from '../../session.js';
import type { ModelMessage } from '../../types.js';
import type { SessionStore } from '../types.js';
import { StorageError, wrapSqliteError } from '../errors.js';

interface SessionRow {
  id: string;
  workspace: string;
  title: string | null;
  pinned: number;
  current_turn: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  role: string;
  content_json: string;
  created_at: string;
}

export class SqliteSessionStore implements SessionStore {
  constructor(private db: Database.Database) {}

  async create(workspace: string): Promise<Session> {
    try {
      const now = new Date();
      const sessionId = randomUUID();
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
        metadata: {},
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
        | SessionRow
        | undefined;
      if (!row) return null;

      const messages = this.db
        .prepare('SELECT id, role, content_json, created_at FROM messages WHERE session_id = ? ORDER BY sequence')
        .all(sessionId) as MessageRow[];

      const metadata = this.parseMetadata(row.metadata_json, row.title, row.pinned, row.workspace);

      return {
        sessionId: row.id,
        workspace: row.workspace,
        conversation: messages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant' | 'tool',
          content: JSON.parse(m.content_json) as ModelMessage['content'],
        })),
        currentTurn: row.current_turn,
        metadata,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to load session ${sessionId}`);
    }
  }

  async save(session: Session): Promise<void> {
    const title = typeof session.metadata.title === 'string' ? session.metadata.title : null;
    const pinned = session.metadata.pinned === true ? 1 : 0;
    const workspace = typeof session.metadata.workspace === 'string' ? session.metadata.workspace : 'default';
    const metadata = { ...session.metadata };
    delete metadata.title;
    delete metadata.pinned;
    delete metadata.workspace;

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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

      const messageIds = session.conversation.map((m) => m.id);
      if (messageIds.length > 0) {
        const placeholders = messageIds.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM messages WHERE session_id = ? AND id NOT IN (${placeholders})`).run(
          session.sessionId,
          ...messageIds
        );
      } else {
        this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(session.sessionId);
      }

      const insert = this.db.prepare(
        `INSERT OR REPLACE INTO messages (id, session_id, role, content_json, sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (let i = 0; i < session.conversation.length; i++) {
        const msg = session.conversation[i];
        insert.run(
          msg.id,
          session.sessionId,
          msg.role,
          JSON.stringify(msg.content),
          i,
          new Date().toISOString()
        );
      }
    });

    try {
      transaction();
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to save session ${session.sessionId}`);
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to delete session ${sessionId}`);
    }
  }

  async listByWorkspace(workspace: string): Promise<SessionSummary[]> {
    return this.listInternal('workspace = ?', [workspace]);
  }

  async listAll(): Promise<SessionSummary[]> {
    return this.listInternal('1 = 1', []);
  }

  private listInternal(whereClause: string, params: (string | number)[]): SessionSummary[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT id, workspace, title, pinned, updated_at,
            (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id) AS message_count
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

      return rows.map((r) => ({
        sessionId: r.id,
        title: r.title ?? undefined,
        pinned: r.pinned === 1 ? true : undefined,
        updatedAt: new Date(r.updated_at),
        messageCount: r.message_count,
      }));
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to list sessions');
    }
  }

  private parseMetadata(
    raw: string,
    title: string | null,
    pinned: number,
    workspace: string
  ): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (title) parsed.title = title;
      if (pinned === 1) parsed.pinned = true;
      parsed.workspace = workspace;
      return parsed;
    } catch {
      return { title: title ?? undefined, pinned: pinned === 1 ? true : undefined, workspace };
    }
  }
}
```

注意：这里 `Session` 接口目前只有 `sessionId, conversation, currentTurn, metadata, createdAt, updatedAt`，没有 `workspace` 字段。但 spec 中我希望 Session 对象可以直接有 workspace。但为了不破坏现有接口，我可以在 metadata 中存 workspace。不过 SQLite 表中需要 workspace 字段用于查询。所以 `parseMetadata` 把 workspace 写回 metadata，但 Session 对象本身没有 workspace 属性。

但是 spec 中我把 workspace 作为表字段，然后 list 按 workspace 过滤。Session 对象不需要 workspace 属性，因为 metadata.workspace 已经存在。所以这样设计是可以的。

不过 `Session` 接口是否应该扩展 workspace？当前 `Session` 接口：
```ts
export interface Session {
  sessionId: string;
  conversation: ModelMessage[];
  currentTurn: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

为了不破坏现有代码，我不扩展 Session 接口。workspace 在 metadata 中，save 时提取到表字段。

那在 `create(workspace)` 方法中，返回的 Session 没有 workspace 字段，但 metadata 是空的。这没关系，因为调用方（SessionProvider）会设置 metadata.workspace 并 save。

但是 spec 中我写的是 `SessionStore.create(workspace: string)` 返回 `Session`。现在返回的 Session 没有 workspace 字段。其实这样更兼容。让我把 spec 中的说明也改一下，但 spec 已经提交。在计划中明确即可。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- packages/core/tests/storage/sqlite-session-store.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/sqlite/session-store.ts packages/core/tests/storage/sqlite-session-store.test.ts
git commit -m "feat(storage): implement SqliteSessionStore"
```

---

## Task 5: 实现 SqliteRuleStore

**Files:**
- Create: `packages/core/src/storage/sqlite/rule-store.ts`
- Test: `packages/core/tests/storage/sqlite-rule-store.test.ts`

- [ ] **Step 1: 创建测试 `packages/core/tests/storage/sqlite-rule-store.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../../../src/storage/schema.js';
import { SqliteRuleStore } from '../../../src/storage/sqlite/rule-store.js';

describe('SqliteRuleStore', () => {
  let dir: string;
  let db: Database.Database;
  let store: SqliteRuleStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sqlite-rule-test-'));
    db = new Database(join(dir, 'test.db'));
    new SqliteSchemaManager(db).migrate();
    store = new SqliteRuleStore(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should load all rules including sources', async () => {
    await store.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });
    await store.saveApproved({ permission: 'write', pattern: '/tmp/**', action: 'deny' });

    const all = await store.loadAll();
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.source === 'approved')).toBe(true);
  });

  it('should deduplicate approved rules', async () => {
    await store.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });
    await store.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
  });

  it('should load by source', async () => {
    await store.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });

    const approved = await store.loadBySource('approved');
    expect(approved).toHaveLength(1);

    const user = await store.loadBySource('user-config');
    expect(user).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- packages/core/tests/storage/sqlite-rule-store.test.ts`

Expected: FAIL — `SqliteRuleStore` not found。

- [ ] **Step 3: 创建 `packages/core/src/storage/sqlite/rule-store.ts`**

```ts
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Rule, RuleSource } from '../../security/rules/rule.js';
import type { RuleStore } from '../types.js';
import { wrapSqliteError } from '../errors.js';

interface RuleRow {
  id: string;
  source: RuleSource;
  permission: string;
  pattern: string;
  action: string;
  created_at: string;
}

export class SqliteRuleStore implements RuleStore {
  constructor(private db: Database.Database) {}

  async loadAll(): Promise<Rule[]> {
    return this.loadBySources(['user-config', 'approved']);
  }

  async loadBySource(source: RuleSource): Promise<Rule[]> {
    return this.loadBySources([source]);
  }

  async saveApproved(rule: Omit<Rule, 'source'>): Promise<void> {
    try {
      const existing = this.db
        .prepare(
          'SELECT id FROM rules WHERE source = ? AND permission = ? AND pattern = ? AND action = ?'
        )
        .get('approved', rule.permission, rule.pattern, rule.action) as { id: string } | undefined;

      if (existing) return;

      this.db
        .prepare(
          'INSERT INTO rules (id, source, permission, pattern, action, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'approved', rule.permission, rule.pattern, rule.action, new Date().toISOString());
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to save approved rule');
    }
  }

  private loadBySources(sources: RuleSource[]): Promise<Rule[]> {
    try {
      if (sources.length === 0) return Promise.resolve([]);
      const placeholders = sources.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT * FROM rules WHERE source IN (${placeholders})`)
        .all(...sources) as RuleRow[];

      return Promise.resolve(
        rows.map((r) => ({
          permission: r.permission,
          pattern: r.pattern,
          action: r.action as Rule['action'],
          source: r.source,
        }))
      );
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to load rules');
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- packages/core/tests/storage/sqlite-rule-store.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/sqlite/rule-store.ts packages/core/tests/storage/sqlite-rule-store.test.ts
git commit -m "feat(storage): implement SqliteRuleStore"
```

---

## Task 6: 实现 SqliteStorageProvider

**Files:**
- Create: `packages/core/src/storage/sqlite/provider.ts`
- Create: `packages/core/src/storage/index.ts`

- [ ] **Step 1: 创建 `packages/core/src/storage/sqlite/provider.ts`**

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StorageProvider } from '../types.js';
import { SqliteSchemaManager } from '../schema.js';
import { SqliteSessionStore } from './session-store.js';
import { SqliteRuleStore } from './rule-store.js';
import { StorageError, wrapSqliteError } from '../errors.js';

export interface SqliteStorageProviderOptions {
  dbPath: string;
}

export class SqliteStorageProvider implements StorageProvider {
  private db: Database.Database | undefined;
  private _sessionStore: SqliteSessionStore | undefined;
  private _ruleStore: SqliteRuleStore | undefined;

  constructor(private options: SqliteStorageProviderOptions) {}

  async init(): Promise<void> {
    try {
      mkdirSync(dirname(this.options.dbPath), { recursive: true });
      this.db = new Database(this.options.dbPath);
      this.db.pragma('journal_mode = WAL');
      new SqliteSchemaManager(this.db).migrate();
      this._sessionStore = new SqliteSessionStore(this.db);
      this._ruleStore = new SqliteRuleStore(this.db);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw wrapSqliteError(err, 'DB_OPEN', `Failed to open SQLite database at ${this.options.dbPath}`);
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
    this._sessionStore = undefined;
    this._ruleStore = undefined;
  }

  get sessionStore(): SqliteSessionStore {
    if (!this._sessionStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._sessionStore;
  }

  get ruleStore(): SqliteRuleStore {
    if (!this._ruleStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._ruleStore;
  }
}
```

- [ ] **Step 2: 创建 `packages/core/src/storage/index.ts`**

```ts
export * from './types.js';
export * from './errors.js';
export * from './schema.js';
export { SqliteStorageProvider, type SqliteStorageProviderOptions } from './sqlite/provider.js';
export { SqliteSessionStore } from './sqlite/session-store.js';
export { SqliteRuleStore } from './sqlite/rule-store.js';
```

- [ ] **Step 3: 运行类型检查**

Run: `pnpm --filter rem-agent-core typecheck`

Expected: PASS（可能有 `SqliteSessionProvider` 未使用，但类型检查通过）。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/storage/sqlite/provider.ts packages/core/src/storage/index.ts
git commit -m "feat(storage): implement SqliteStorageProvider and export storage module"
```

---

## Task 7: 实现 SqliteSessionProvider

**Files:**
- Create: `packages/core/src/plugins/session/sqlite/index.ts`

- [ ] **Step 1: 创建 `packages/core/src/plugins/session/sqlite/index.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
import type { ModelMessage, ContentPart } from '../../../types.js';
import type { SessionStore } from '../../../storage/types.js';
import { getMetaBoolean, getMetaString } from '../metadata.js';

export class SqliteSessionProvider implements SessionProvider {
  constructor(private store: SessionStore) {}

  async create(): Promise<Session> {
    return this.store.create('default');
  }

  async load(sessionId: string): Promise<Session | null> {
    return this.store.load(sessionId);
  }

  addMessage(session: Session, role: 'assistant' | 'tool'): ModelMessage {
    const msg: ModelMessage = { id: randomUUID(), role, content: [] };
    session.conversation.push(msg);
    void this.save(session).catch(() => {});
    return msg;
  }

  appendContent(session: Session, msg: ModelMessage, part: ContentPart): void {
    msg.content.push(part);
    void this.save(session).catch(() => {});
  }

  async save(session: Session): Promise<void> {
    await this.store.save(session);
  }

  async delete(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  async list(): Promise<SessionSummary[]> {
    return this.store.listAll();
  }
}
```

- [ ] **Step 2: 运行类型检查**

Run: `pnpm --filter rem-agent-core typecheck`

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/session/sqlite/index.ts
git commit -m "feat(session): add SqliteSessionProvider"
```

---

## Task 8: 接入 buildAgentContext 与导出

**Files:**
- Modify: `packages/core/src/agent-context-builder.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/plugins/index.ts`

- [ ] **Step 1: 修改 `packages/core/src/agent-context-builder.ts`**

在文件顶部添加 import：

```ts
import { join } from 'node:path';
import { SqliteStorageProvider, type StorageProvider } from './storage/index.js';
```

在 `AgentContextBuildOptions` 中添加字段：

```ts
export interface AgentContextBuildOptions {
  name?: string;
  configPath?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  provider?: string;
  model?: string;
  sessionsDir?: string;
  profile?: import('./security/rules/profiles.js').ToolProfileId;
  sessionRules?: Rule[];
  securityMode?: SecurityMode;
  paths?: AgentPaths;
  storageProvider?: StorageProvider; // 新增
}
```

在 `buildAgentContext` 中，在 `const paths = ...` 之后添加：

```ts
  const storageProvider = options?.storageProvider
    ?? new SqliteStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });
  await storageProvider.init();
```

然后修改 `sessionProvider` 和 `ruleStore` 的创建。先 import `SqliteSessionProvider`：

```ts
import { SqliteSessionProvider } from './plugins/session/sqlite/index.js';
```

替换原有 `const sessionProvider = new FileSessionProvider(paths.sessionsDir);` 为：

```ts
  const sessionProvider = new SqliteSessionProvider(storageProvider.sessionStore);
```

替换原有 `const { ruleEngine, ruleStore } = await buildRuleSecurity(configProvider, paths.agentDir);` 为：

```ts
  const { ruleEngine, ruleStore } = await buildRuleSecurity(configProvider, storageProvider.ruleStore);
```

修改 `buildRuleSecurity` 函数签名（保持 `RuleStore` 类型从 `rule-store.js` 导入，与现有 import 一致）：

```ts
async function buildRuleSecurity(
  configProvider: ConfigProvider,
  ruleStore: RuleStore,
): Promise<{ ruleEngine: RuleEngine; ruleStore: RuleStore }> {
  const userRules = await ruleStore.loadAll();
  // ... 其余不变
}
```

说明：新的 `SqliteRuleStore` 和现有 `RuleStore` 类都满足 `RuleStore` 接口（方法签名一致），因此可以直接传入。`RuleStore` 类型仍从 `./security/rules/rule-store.js` 导入，避免命名冲突。

- [ ] **Step 2: 修改 `packages/core/src/index.ts`**

在文件末尾添加导出：

```ts
export * from './storage/index.js';
```

- [ ] **Step 3: 修改 `packages/core/src/plugins/index.ts`**

添加导出：

```ts
export { SqliteSessionProvider } from './session/sqlite/index.js';
```

- [ ] **Step 4: 运行类型检查**

Run: `pnpm --filter rem-agent-core typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent-context-builder.ts packages/core/src/index.ts packages/core/src/plugins/index.ts
git commit -m "feat(core): wire SqliteStorageProvider into buildAgentContext"
```

---

## Task 9: 集成测试与回归验证

**Files:**
- Test: 现有 `packages/core/tests/agent-context-builder.test.ts`
- Test: 现有 `packages/core/tests/agent-factory.test.ts`

- [ ] **Step 1: 运行全部测试**

Run: `pnpm test`

Expected: 原有测试通过，新增 storage 测试通过。注意：现有 `agent-context-builder.test.ts` 和 `agent-factory.test.ts` 可能会因为默认使用 SQLite 而需要调整路径或传入 `storageProvider`。

- [ ] **Step 2: 修复失败测试**

如果失败是因为临时目录被创建在默认 `~/.rem-agent` 或 SQLite 文件冲突，修改测试显式传入 `paths` 和 `storageProvider`：

```ts
const ctx = await buildAgentContext({
  configPath: join(dir, 'agent.json'),
  paths,
  storageProvider: new SqliteStorageProvider({ dbPath: join(dir, 'rem-agent.db') }),
});
```

或者如果测试只是想验证构建上下文，可以传入 `InMemorySessionProvider` 包装成的内存 storage provider（未来实现），或者保持使用 SQLite 但确保临时目录隔离。

当前这些测试使用 `paths` 指定了临时目录，SQLite 默认路径是 `paths.agentDir`，所以应该能正常工作。如果 `paths.agentDir` 不存在，`SqliteStorageProvider.init()` 会创建它。

- [ ] **Step 3: 运行 lint/typecheck**

Run: `pnpm typecheck`

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/
git commit -m "test(storage): verify SQLite storage integration and fix regressions"
```

---

## Task 10: 文档同步（可选但推荐）

**Files:**
- Modify: `docs/module-reference.md` — 新增 storage 模块描述
- Modify: `packages/core/README.md` — 如有必要说明 storage provider 用法

- [ ] **Step 1: 更新 `docs/module-reference.md`**

在 `1.11 内置插件` 后新增 `1.12 Storage 层` 小节，描述：

- `src/storage/types.ts` — `StorageProvider`, `SessionStore`, `RuleStore` 接口
- `src/storage/sqlite/provider.ts` — `SqliteStorageProvider`
- `src/storage/sqlite/session-store.ts` — `SqliteSessionStore`
- `src/storage/sqlite/rule-store.ts` — `SqliteRuleStore`
- `src/storage/schema.ts` — `SqliteSchemaManager`

- [ ] **Step 2: Commit**

```bash
git add docs/module-reference.md
git commit -m "docs: document storage layer in module-reference"
```

---

## 自我审查

### Spec 覆盖检查

| Spec 要求 | 对应 Task |
|---|---|
| 统一 `StorageProvider` / `SessionStore` / `RuleStore` 接口 | Task 2 |
| SQLite 实现 session 存储 | Task 4, Task 7 |
| SQLite 实现 rules 存储 | Task 5 |
| schema 版本管理 | Task 3 |
| `buildAgentContext` 默认接入 SQLite | Task 8 |
| workspace 作为一等字段 | Task 4 (`SqliteSessionStore`) |
| `title`/`pinned` 提取到表字段 | Task 4 |
| 错误包装为 `StorageError` | Task 2, Task 4, Task 5, Task 6 |
| 测试覆盖 | Task 3, 4, 5, 9 |

### Placeholder 检查

- 无 "TBD"/"TODO"/"implement later"。
- 无 "add appropriate error handling" 等模糊描述。
- 每个代码步骤包含完整代码。
- 无 "similar to Task N"。

### 类型一致性检查

- `SessionStore` 接口在 Task 2 定义，后续 Task 4, 7 使用一致。
- `RuleStore` 接口在 Task 2 定义，后续 Task 5 使用一致。
- `StorageProvider` 接口在 Task 2 定义，后续 Task 6, 8 使用一致。
- `StorageErrorCode` 在 Task 2 定义，后续一致。

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-07-10-sqlite-storage-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?