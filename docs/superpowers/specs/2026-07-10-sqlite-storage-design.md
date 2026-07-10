# SQLite 存储层设计

> 日期：2026-07-10
> 状态：设计待实现

---

## 1. 背景与目标

当前 `rem-agent-core` 的持久化散落在多个 JSON/JSONL 文件实现中：

- `session`：`FileSessionProvider`/`LocalSessionProvider` 使用 `jsonl` + `meta.json` 存储会话消息与元数据；`InMemorySessionProvider` 仅内存保存。
- `rules`：`RuleStore` 使用 `permissions.json` 存储用户配置规则和审批规则。
- `agent live state`：目前仅内存维护，不涉及持久化。

本设计目标：

1. 将 session、rules 等持久化数据统一迁移到 **SQLite**。
2. 把存储层作为独立基建，抽象出 `StorageProvider` 接口，支持后续替换其他后端。
3. 使用 `better-sqlite3` 手写 schema 与 SQL，不引入 ORM/Prisma。
4. 保留 workspace 作为一等查询字段，避免在 JSON 中过滤。

---

## 2. 范围

### 2.1 In Scope

- 新增 `StorageProvider` / `SessionStore` / `RuleStore` 接口。
- 实现 `SqliteStorageProvider`（包含 `SqliteSessionStore` 和 `SqliteRuleStore`）。
- 将 `sessions` 和 `messages` 数据存入 SQLite。
- 将 `rules` 数据从 `permissions.json` 迁移到 SQLite。
- `buildAgentContext` 接入 `StorageProvider`，默认使用 SQLite。
- schema 版本管理（`schema_version` 表）。

### 2.2 Out of Scope

- `AgentLiveState` 不持久化，继续保留在内存中。
- `config` 文件读取（JSON/YAML）不迁移到 SQLite。
- skill 文件、debug log 等文件型数据不迁移。
- 不自动迁移旧版 JSON/JSONL 数据到 SQLite；SQLite 作为新后端，旧数据读不到即视为不存在。
- 不引入 ORM、Prisma、Kysely 等中间层。

---

## 3. 决策摘要

| 问题 | 决策 |
|---|---|
| 目标后端 | SQLite |
| SQLite 库 | `better-sqlite3` |
| ORM/迁移工具 | 不引入，手写 SQL + schema 版本管理 |
| 接口抽象 | 统一的 `StorageProvider` 门面，下辖 `SessionStore` 和 `RuleStore` |
| Provider 切换方式 | `buildAgentContext({ storageProvider: new SqliteStorageProvider(...) })` 直接传入实例；后续可扩展其他实现 |
| 数据库文件 | 默认 `~/.rem-agent/rem-agent.db`，可配置 |
| 旧数据迁移 | 不迁移，新后端从零开始 |
| Session 拆分 | `sessions` 表 + `messages` 表，messages 中 `content_json` 整存 `ContentPart[]` |
| Workspace | `sessions` 表一等字段 `workspace`，建立索引 |

---

## 4. 整体架构

在 `rem-agent-core` 内部新增 `src/storage/` 目录，作为独立基建层。

```
src/storage/
├── types.ts              # StorageProvider, SessionStore, RuleStore 接口
├── errors.ts             # StorageError
├── schema.ts             # schema 定义与版本管理
├── sqlite/
│   ├── provider.ts       # SqliteStorageProvider
│   ├── session-store.ts  # SqliteSessionStore
│   └── rule-store.ts     # SqliteRuleStore
└── index.ts              # 公开导出
```

### 4.1 与 Core 的接入关系

```
buildAgentContext(options)
  │
  ├─ 构造/接收 StorageProvider
  │   默认：new SqliteStorageProvider({ dbPath: join(agentDir, 'rem-agent.db') })
  │
  ├─ storageProvider.init()  // 建库、建表、检查版本
  │
  ├─ sessionProvider = new SqliteSessionProvider(storageProvider.sessionStore)
  │
  └─ ruleStore = storageProvider.ruleStore
```

### 4.2 接口定义

```ts
interface StorageProvider {
  init(): Promise<void>;
  close(): Promise<void>;
  readonly sessionStore: SessionStore;
  readonly ruleStore: RuleStore;
}

interface SessionStore {
  create(workspace: string): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  listByWorkspace(workspace: string): Promise<SessionSummary[]>;
  listAll(): Promise<SessionSummary[]>;
}

interface RuleStore {
  loadAll(): Promise<Rule[]>;
  loadBySource(source: RuleSource): Promise<Rule[]>;
  saveApproved(rule: Omit<Rule, 'source'>): Promise<void>;
}
```

说明：

- 新接口 `RuleStore` 与现有 `RuleStore` 类同名，现有 `RuleStore` 类可直接实现该接口（方法签名一致）。
- `SessionProvider` 现有接口（`create()` 无参）保持不变；`SqliteSessionProvider.create()` 内部调用 `sessionStore.create('default')`，然后由 `AgentSessionManager.createSession(workspace)` 设置 `session.metadata.workspace` 并 save，底层 save 再同步到 `sessions.workspace` 字段。
- `SessionProvider` 仍保留 `addMessage`/`appendContent` 内存操作，底层 `save` 委托给 `SessionStore`。

---

## 5. SQLite Schema

### 5.1 版本表

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
```

启动时检查并写入当前版本 `1`。

### 5.2 会话表

```sql
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
```

`workspace` 是 Bridge/Web 中用于会话隔离的字段，提升为表字段后可高效按 workspace 过滤和排序。

### 5.3 消息表

```sql
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
```

`content_json` 列整段保存 `ContentPart[]` JSON；`sequence` 保存消息在 conversation 中的顺序，保证加载顺序。

### 5.4 规则表

```sql
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,        -- 'user-config' | 'approved'
  permission TEXT NOT NULL,
  pattern TEXT NOT NULL,
  action TEXT NOT NULL,        -- 'allow' | 'deny'
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_source
  ON rules(source);
```

`default` 来源的规则由 `RuleEngine` 在内存中注入，不写入持久化。

---

## 6. 组件职责

### 6.1 `SqliteStorageProvider`

- 持有 `better-sqlite3` 的 `Database` 连接。
- `init()` 打开数据库、建表、检查/写入 `schema_version`。
- `close()` 关闭连接。
- 暴露 `sessionStore` 和 `ruleStore`，两者共享同一连接。

### 6.2 `SqliteSessionStore`

- `create(workspace)`：插入新 session 行，返回 `Session`；`workspace` 默认 `'default'`。
- `load(id)`：查询 `sessions` 行和按 `sequence` 排序的 messages，组装成 `Session`；`title`/`pinned`/`workspace` 从表字段写回 `metadata`。
- `save(session)`：在事务中完成：
  1. 从 `session.metadata` 提取 `title`、`pinned`、`workspace` 到表字段，其余 metadata 序列化为 `metadata_json`。
  2. `INSERT OR REPLACE` 更新 `sessions` 行。
  3. 删除当前 conversation 中不存在的 messages。
  4. `INSERT OR REPLACE` 所有 messages，保留 message id。
- `delete(id)`：删除 sessions 行，messages 通过级联外键自动删除。
- `listByWorkspace(workspace)` / `listAll()`：按 `updated_at` 降序，并计算 `messageCount`。`title` 和 `pinned` 从表字段读取，不解析 JSON。

### 6.3 `SqliteRuleStore`

- `loadAll()`：读取 `source` 为 `user-config` 或 `approved` 的所有规则。
- `loadBySource(source)`：按 source 过滤。
- `saveApproved(rule)`：先查重（相同 `permission` + `pattern` + `action`），不存在则插入。

### 6.4 `SchemaManager`

- 负责 schema 版本读取和迁移。
- 当前版本为 `1`。
- 后续改表/加字段时按版本号顺序执行 migration。

### 6.5 `StorageError`

所有 SQLite 操作失败都包装为 `StorageError`，并保留原始错误为 `cause`。

错误码：

- `DB_OPEN`：数据库无法打开。
- `DB_QUERY`：SQL 执行失败。
- `DB_CONSTRAINT`：约束/外键冲突。
- `DB_MIGRATION`：schema 版本升级失败。

---

## 7. 数据流

### 7.1 初始化

```ts
const storageProvider = options?.storageProvider
  ?? new SqliteStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });

await storageProvider.init();

const sessionProvider = new SqliteSessionProvider(storageProvider.sessionStore);
const ruleStore = storageProvider.ruleStore;
```

`init()` 失败时直接抛出，避免 Core 在数据库不可用时继续运行。

### 7.2 创建会话

```ts
// AgentSessionManager.createSession('default')
const session = await sessionProvider.create();  // SessionProvider.create() 仍无参
session.metadata.workspace = 'default';
await sessionProvider.save(session);
// 底层 save 将 metadata.workspace 同步到 sessions.workspace 字段
```

`SessionProvider.create()` 保持无参，内部调用 `sessionStore.create('default')`。真正的 workspace 由调用方设置 `metadata.workspace` 后通过 save 持久化。

### 7.3 追加消息

```ts
const msg = sessionProvider.addMessage(session, 'assistant');
sessionProvider.appendContent(session, msg, { type: 'text-delta', text: '...' });
// 内存更新后，由 sessionProvider.save(session) 触发落库
```

### 7.4 保存会话

```sql
BEGIN;

-- 从 session.metadata 提取 title/pinned/workspace 到表字段，其余 metadata 保留在 metadata_json
INSERT OR REPLACE INTO sessions (
  id, workspace, title, pinned, current_turn, metadata_json, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?);

DELETE FROM messages
WHERE session_id = ? AND id NOT IN (...);

INSERT OR REPLACE INTO messages (
  id, session_id, role, content_json, sequence, created_at
) VALUES (?, ?, ?, ?, ?, ?), ...;

COMMIT;
```

`sequence` 使用 conversation 数组下标，确保加载顺序一致。

### 7.5 加载会话

```sql
SELECT * FROM sessions WHERE id = ?;
SELECT * FROM messages WHERE session_id = ? ORDER BY sequence ASC;
```

组装为 `Session` 对象返回。

### 7.6 列会话

```sql
SELECT id, workspace, title, pinned, updated_at,
  (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id) AS message_count
FROM sessions
WHERE workspace = ?
ORDER BY updated_at DESC;
```

### 7.7 保存规则

```sql
SELECT id FROM rules
WHERE source = 'approved'
  AND permission = ? AND pattern = ? AND action = ?;

-- 不存在时
INSERT INTO rules (id, source, permission, pattern, action, created_at)
VALUES (?, 'approved', ?, ?, ?, ?);
```

---

## 8. 错误处理与并发

### 8.1 错误处理

- SQLite 原生错误统一包装为 `StorageError`。
- `buildAgentContext` 在 `storageProvider.init()` 失败时直接抛出，启动失败好过运行期数据丢失。
- `save`/`delete` 等运行时失败向上抛 `StorageError`，不静默吞掉。

### 8.2 并发策略

- `better-sqlite3` 为同步 API，单 Node 进程内写操作天然串行。
- 所有写操作使用 `db.transaction()` 保证原子性。
- 读操作直接执行 prepared statement，不加额外锁。

---

## 9. 测试

新增测试文件：

- `packages/core/tests/storage/sqlite-session-store.test.ts`
- `packages/core/tests/storage/sqlite-rule-store.test.ts`
- `packages/core/tests/storage/schema-manager.test.ts`

测试要点：

- 使用临时目录 + 临时 `.db` 文件，每个测试后清理。
- `create`/`load`/`save`/`delete`/`list`。
- workspace 过滤与排序。
- message 顺序和 content_json 序列化/反序列化。
- 事务一致性：失败时数据不残留。
- schema 版本初始化与升级。
- rule 去重行为。
- 现有 `file-session-provider.test.ts` 和 `rule-store.test.ts` 保留，确保旧兼容实现不被破坏。

验收命令：

```bash
pnpm typecheck
pnpm test
```

---

## 10. 影响面

### 10.1 修改文件

- `packages/core/src/storage/`：新增整套存储层。
- `packages/core/src/agent-context-builder.ts`：接入 `StorageProvider`。
- `packages/core/src/index.ts`：导出新的公开接口和实现。
- `packages/core/package.json`：新增 `better-sqlite3` 依赖。
- `packages/core/tests/storage/`：新增测试。

### 10.2 不修改的文件

- `FileSessionProvider`/`LocalSessionProvider`/`InMemorySessionProvider` 保留作为可选兼容实现。
- `RuleStore` 原有文件保留，可继续独立使用。
- `AgentLiveState` 相关实现保持内存，不接入 SQLite。

### 10.3 对 Bridge/Web 的影响

- Bridge 的 `AgentSessionManager` 当前按 `session.metadata.workspace` 过滤，迁库后可改为直接调用 `listByWorkspace(workspace)`，减少不必要的全量加载。
- 不强制修改 Bridge/Web；先保持 Core 接口兼容。

---

## 11. 后续可扩展点

- 未来可新增 `FileStorageProvider` 或 `MemoryStorageProvider` 实现统一接口。
- 如需要把 `AgentLiveState` 持久化，可在 `StorageProvider` 下新增 `LiveStateStore` 子接口。
- 未来需要会话搜索/分页时，可直接在 `messages` 表上扩展索引或全文搜索。
