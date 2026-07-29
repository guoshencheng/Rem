# pi-agent-core Agent 循环迁移实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `@earendil-works/pi-agent-core` 的 `Agent` 类替换 rem 自建 ReactLoop，session 存储迁移到 tree entry 模型，并暴露 steer/followUp。

**Architecture:** 见 spec `docs/superpowers/specs/2026-07-29-pi-agent-loop-migration-design.md`。`src/run-agent.ts` 变为薄 re-export，新实现拆到 `src/run-agent/` 目录（factory/tool-bridge/event-bridge/session-writer/context-bridge）；session 线性存储换为 `src/session-tree/` 的 entry 树。

**Tech Stack:** TypeScript、vitest、better-sqlite3、`@earendil-works/pi-ai@^0.82.1`（含 faux provider 测试工具）、`@earendil-works/pi-agent-core@^0.82.1`。

**关键事实（实现者必读）：**

- pi `AgentEvent` 的 `message_update` 只转发 `text_*/thinking_*/toolcall_*` 事件，**不含** `start/done/error`；bridge `stream-reducer.ts` 对这三类事件本就是 no-op，安全。
- pi `Agent` 的 `subscribe(listener)` 按注册顺序逐个 await，写盘 listener 会阻塞后续事件直到完成（这正是我们要的语义）。
- pi 工具约定：`execute` 抛异常 → loop 自动转 `isError: true` toolResult；`beforeToolCall` 返回 `{ block: true, reason }` → 不执行，生成 error toolResult。
- pi Agent 无 maxSteps 概念，maxTurns 用 `turn_end` 计数 + `agent.abort()` 实现。
- `import { Agent } from '@earendil-works/pi-agent-core'`；类型 `AgentTool / AgentEvent / BeforeToolCallContext / BeforeToolCallResult / AgentMessage / StreamFn / AgentOptions` 同包导出。
- faux provider：`import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'`，注册进 `createCoreModels({ customProviders: [handle.provider] })`，`handle.setResponses([...])` 喂固定响应。
- 文件与目录可同名共存：`src/run-agent.ts`（文件）与 `src/run-agent/`（目录）不冲突；`'./run-agent.js'` 在 NodeNext 下解析到文件。

---

### Task 1: 升级 pi-ai 并新增 pi-agent-core 依赖

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/bridge/package.json`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: 修改依赖**

`packages/core/package.json` dependencies 中：
- `"@earendil-works/pi-ai": "^0.80.7"` → `"^0.82.1"`
- 新增 `"@earendil-works/pi-agent-core": "^0.82.1"`

`packages/bridge/package.json`：`"@earendil-works/pi-ai"` → `"^0.82.1"`。

`pnpm-workspace.yaml`：将 `- '@earendil-works/pi-ai@0.80.7'` 改为 `- '@earendil-works/pi-ai@0.82.1'`。

- [ ] **Step 2: 安装并验证**

Run: `pnpm install && node -e "import('@earendil-works/pi-agent-core').then(m=>console.log(typeof m.Agent))"`
Expected: 输出 `function`

- [ ] **Step 3: 全量回归**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿（升级 pi-ai 小版本不应破坏现有行为；若有 break 先修再提交）

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json packages/bridge/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(deps): upgrade pi-ai to 0.82.1 and add pi-agent-core"
```

---

### Task 2: session-tree 类型与 context-builder（纯函数）

**Files:**
- Create: `packages/core/src/session-tree/types.ts`
- Create: `packages/core/src/session-tree/context-builder.ts`
- Test: `packages/core/tests/session-tree-context-builder.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/session-tree-context-builder.test.ts
import { describe, it, expect } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { buildConversationFromEntries } from '../src/session-tree/context-builder.js';
import type { SessionTreeEntry } from '../src/session-tree/types.js';

const msg = (text: string): Message => ({ role: 'user', content: text, timestamp: 1 });
const entry = (id: string, parentId: string | null, text: string): SessionTreeEntry => ({
  id, sessionId: 's1', parentId, type: 'message',
  payload: { message: msg(text), messageId: id }, timestamp: 1,
});

describe('buildConversationFromEntries', () => {
  it('walks leaf to root and returns messages in order', () => {
    const entries = [entry('a', null, 'first'), entry('b', 'a', 'second'), entry('c', 'b', 'third')];
    const result = buildConversationFromEntries(entries, 'c');
    expect(result.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('returns empty array when leafId is null', () => {
    expect(buildConversationFromEntries([entry('a', null, 'x')], null)).toEqual([]);
  });

  it('ignores orphan branches not on the leaf path', () => {
    const entries = [entry('a', null, 'main'), entry('b', 'a', 'main2'), entry('x', 'a', 'orphan')];
    const result = buildConversationFromEntries(entries, 'b');
    expect(result.map((m) => m.content)).toEqual(['main', 'main2']);
  });

  it('skips non-message entries on the path', () => {
    const label: SessionTreeEntry = { id: 'l', sessionId: 's1', parentId: 'a', type: 'label', payload: { label: 'x' }, timestamp: 1 };
    const entries = [entry('a', null, 'main'), label];
    expect(buildConversationFromEntries(entries, 'l').map((m) => m.content)).toEqual(['main']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- session-tree-context-builder`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// packages/core/src/session-tree/types.ts
import type { Message } from '@earendil-works/pi-ai';

export type SessionTreeEntryType = 'message' | 'model_change' | 'label';

export interface MessageEntryPayload {
  message: Message;
  messageId: string;
}

export interface SessionTreeEntry {
  id: string;
  sessionId: string;
  parentId: string | null;
  type: SessionTreeEntryType;
  payload: unknown;
  timestamp: number;
}
```

```typescript
// packages/core/src/session-tree/context-builder.ts
import type { Message } from '@earendil-works/pi-ai';
import type { MessageEntryPayload, SessionTreeEntry } from './types.js';

export function buildConversationFromEntries(
  entries: SessionTreeEntry[],
  leafId: string | null,
): Message[] {
  if (!leafId) return [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const chain: SessionTreeEntry[] = [];
  let current: SessionTreeEntry | undefined = byId.get(leafId);
  while (current) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  chain.reverse();
  return chain
    .filter((e) => e.type === 'message')
    .map((e) => (e.payload as MessageEntryPayload).message);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- session-tree-context-builder`
Expected: PASS（4 个用例）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session-tree packages/core/tests/session-tree-context-builder.test.ts
git commit -m "feat(core): add session-tree entry types and context builder"
```

---

### Task 3: SQLite schema v9（session_entries + active_leaf_id + 数据迁移）

**Files:**
- Modify: `packages/core/src/plugins/storage/sqlite/schema.ts`
- Test: `packages/core/tests/storage/session-tree-migration.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/storage/session-tree-migration.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteSchemaManager, CURRENT_SCHEMA_VERSION } from '../../src/plugins/storage/sqlite/schema.js';

describe('schema v9 session tree migration', () => {
  it('creates session_entries and active_leaf_id on fresh database', () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('session_entries');
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('active_leaf_id');
    expect(CURRENT_SCHEMA_VERSION).toBe(9);
  });

  it('migrates linear messages into a single chain', () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    db.prepare("INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at) VALUES ('s1','default',NULL,0,0,'{}','2026-01-01','2026-01-01')").run();
    const insert = db.prepare("INSERT INTO messages (id, session_id, role, content_json, tool_call_id, tool_name, sequence, created_at) VALUES (?,?,?,?,?,?,?,?)");
    insert.run('m1', 's1', 'user', '"hello"', null, null, 0, '2026-01-01');
    insert.run('m2', 's1', 'assistant', '[]', null, null, 1, '2026-01-01');
    db.prepare('UPDATE schema_version SET version = 8').run();

    new SqliteSchemaManager(db).migrate();

    const entries = db.prepare("SELECT * FROM session_entries WHERE session_id = 's1' ORDER BY created_at, rowid").all() as any[];
    expect(entries).toHaveLength(2);
    expect(entries[0].parent_id).toBeNull();
    expect(entries[1].parent_id).toBe(entries[0].id);
    const session = db.prepare("SELECT active_leaf_id FROM sessions WHERE id = 's1'").get() as any;
    expect(session.active_leaf_id).toBe(entries[1].id);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- session-tree-migration`
Expected: FAIL（CURRENT_SCHEMA_VERSION 为 8，无 session_entries 表）

- [ ] **Step 3: 实现**

`schema.ts` 修改：
1. `CURRENT_SCHEMA_VERSION = 9`。
2. `sessions` 的 CREATE TABLE 加一行 `active_leaf_id TEXT,`（放在 `metadata_json` 后）。
3. 基础 `db.exec` 块追加：

```sql
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
```

4. `migrateFrom` 追加：

```typescript
if (version < 9) {
  const cols = this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'active_leaf_id')) {
    this.db.exec('ALTER TABLE sessions ADD COLUMN active_leaf_id TEXT');
  }
  const sessions = this.db.prepare('SELECT id FROM sessions').all() as { id: string }[];
  for (const { id } of sessions) {
    const migrateSession = this.db.transaction(() => {
      const messages = this.db
        .prepare('SELECT role, content_json, tool_call_id, tool_name FROM messages WHERE session_id = ? ORDER BY sequence')
        .all(id) as { role: string; content_json: string; tool_call_id: string | null; tool_name: string | null }[];
      let parentId: string | null = null;
      let leafId: string | null = null;
      const insertEntry = this.db.prepare(
        'INSERT INTO session_entries (id, session_id, parent_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const row of messages) {
        const entryId = crypto.randomUUID();
        const message = row.role === 'toolResult'
          ? { role: 'toolResult', toolCallId: row.tool_call_id ?? '', toolName: row.tool_name ?? '', content: JSON.parse(row.content_json), isError: false, timestamp: Date.now() }
          : { role: row.role, content: JSON.parse(row.content_json), timestamp: Date.now() };
        insertEntry.run(entryId, id, parentId, 'message', JSON.stringify({ message, messageId: entryId }), Date.now());
        parentId = entryId;
        leafId = entryId;
      }
      if (leafId) {
        this.db.prepare('UPDATE sessions SET active_leaf_id = ? WHERE id = ?').run(leafId, id);
      }
    });
    migrateSession();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- session-tree-migration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/storage/sqlite/schema.ts packages/core/tests/storage/session-tree-migration.test.ts
git commit -m "feat(core): schema v9 session_entries tree with linear data migration"
```

---

### Task 4: SessionStore tree 方法与 SessionProvider.appendMessage

**Files:**
- Modify: `packages/core/src/sdk/storage-provider.ts`
- Modify: `packages/core/src/sdk/session-provider.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/session-store.ts`
- Modify: `packages/core/src/plugins/session/default/index.ts`
- Modify: `packages/core/src/plugins/session/in-memory/index.ts`
- Test: `packages/core/tests/storage/session-tree-store.test.ts`

注意：本任务**新增** `appendMessage`，**不删除** `addMessage/appendContent`（旧 ReactLoop 仍在用，Task 12 统一删）。

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/storage/session-tree-store.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../../src/plugins/storage/sqlite/schema.js';
import { SqliteSessionStore } from '../../src/plugins/storage/sqlite/session-store.js';
import type { SessionTreeEntry } from '../../src/session-tree/types.js';

const setup = async () => {
  const db = new Database(':memory:');
  new SqliteSchemaManager(db).migrate();
  const store = new SqliteSessionStore(db);
  const session = await store.create('default');
  return { store, session };
};

const msgEntry = (id: string, sessionId: string, parentId: string | null, text: string): SessionTreeEntry => ({
  id, sessionId, parentId, type: 'message',
  payload: { message: { role: 'user', content: text, timestamp: 1 }, messageId: id },
  timestamp: Date.now(),
});

describe('SqliteSessionStore tree entries', () => {
  it('appendEntry advances the active leaf', async () => {
    const { store, session } = await setup();
    await store.appendEntry(msgEntry('e1', session.sessionId, null, 'a'));
    expect(await store.getActiveLeafId(session.sessionId)).toBe('e1');
    await store.appendEntry(msgEntry('e2', session.sessionId, 'e1', 'b'));
    expect(await store.getActiveLeafId(session.sessionId)).toBe('e2');
  });

  it('load rebuilds conversation from the leaf chain', async () => {
    const { store, session } = await setup();
    await store.appendEntry(msgEntry('e1', session.sessionId, null, 'a'));
    await store.appendEntry(msgEntry('e2', session.sessionId, 'e1', 'b'));
    const loaded = await store.load(session.sessionId);
    expect(loaded!.conversation.map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('save no longer rewrites messages and preserves entries', async () => {
    const { store, session } = await setup();
    await store.appendEntry(msgEntry('e1', session.sessionId, null, 'a'));
    const loaded = await store.load(session.sessionId);
    loaded!.metadata.title = 't';
    await store.save(loaded!);
    expect((await store.listEntries(session.sessionId))).toHaveLength(1);
    expect((await store.load(session.sessionId))!.metadata.title).toBe('t');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- session-tree-store`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现**

`sdk/storage-provider.ts` `SessionStore` 接口追加：

```typescript
appendEntry(entry: SessionTreeEntry): Promise<void>;
getActiveLeafId(sessionId: string): Promise<string | null>;
listEntries(sessionId: string): Promise<SessionTreeEntry[]>;
```

（顶部 `import type { SessionTreeEntry } from '../session-tree/types.js';`）

`sqlite/session-store.ts`：
1. 实现三个方法：

```typescript
async appendEntry(entry: SessionTreeEntry): Promise<void> {
  try {
    const tx = this.db.transaction(() => {
      this.db.prepare(
        'INSERT INTO session_entries (id, session_id, parent_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(entry.id, entry.sessionId, entry.parentId, entry.type, JSON.stringify(entry.payload), entry.timestamp);
      this.db.prepare('UPDATE sessions SET active_leaf_id = ? WHERE id = ?').run(entry.id, entry.sessionId);
    });
    tx();
  } catch (err) {
    throw wrapSqliteError(err, 'DB_QUERY', `Failed to append entry ${entry.id}`);
  }
}

async getActiveLeafId(sessionId: string): Promise<string | null> {
  const row = this.db.prepare('SELECT active_leaf_id FROM sessions WHERE id = ?').get(sessionId) as
    | { active_leaf_id: string | null } | undefined;
  return row?.active_leaf_id ?? null;
}

async listEntries(sessionId: string): Promise<SessionTreeEntry[]> {
  const rows = this.db
    .prepare('SELECT id, session_id, parent_id, type, payload, created_at FROM session_entries WHERE session_id = ? ORDER BY rowid')
    .all(sessionId) as { id: string; session_id: string; parent_id: string | null; type: string; payload: string; created_at: number }[];
  return rows.map((r) => ({
    id: r.id, sessionId: r.session_id, parentId: r.parent_id,
    type: r.type as SessionTreeEntry['type'], payload: JSON.parse(r.payload), timestamp: r.created_at,
  }));
}
```

2. `load()`：改为从 entries 重建 conversation——把原来查 `messages` 表的代码替换为：

```typescript
const entries = await this.listEntries(sessionId);
const leafId = await this.getActiveLeafId(sessionId);
const messages = buildConversationFromEntries(entries, leafId);
return toSession(row, messages);
```

注意 `toSession` 当前接收 `MessageRow[]`，需要看 `session-converter.ts` 的签名：若它做 row→Message 转换，则新增/调整使其也能直接接收 `Message[]`（实现时读 `session-converter.ts`，让 `toSession(row, messages: Message[])` 直接灌入 conversation，删除 MessageRow 转换路径——该转换只被 load 使用）。

3. `save()`：删除 messages 表重写段（原 82–108 行的 DELETE + INSERT messages 循环），只保留 sessions 行的 INSERT OR REPLACE。

4. `listWithWhere` 的 `message_count` 子查询改为：
`(SELECT COUNT(*) FROM session_entries WHERE session_id = sessions.id AND type = 'message')`。

`sdk/session-provider.ts` 追加方法（addMessage/appendContent 暂保留）：

```typescript
/** 追加一条已完成的消息并持久化为 tree entry */
appendMessage(session: Session, message: Message, messageId: string): Promise<void>;
```

`plugins/session/default/index.ts`：

```typescript
async appendMessage(session: Session, message: Message, messageId: string): Promise<void> {
  const parentId = await this.store.getActiveLeafId(session.sessionId);
  await this.store.appendEntry({
    id: generateId(),
    sessionId: session.sessionId,
    parentId,
    type: 'message',
    payload: { message, messageId },
    timestamp: Date.now(),
  });
  session.conversation.push(message);
}
```

`plugins/session/in-memory/index.ts`：

```typescript
async appendMessage(session: Session, message: Message, _messageId: string): Promise<void> {
  session.conversation.push(message);
  await this.save(session);
}
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `pnpm --filter rem-agent-core test -- session-tree-store && pnpm typecheck && pnpm test`
Expected: PASS（旧测试不受影响：load 在空 session 上 entries 为空 → conversation 为空，与旧行为一致）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sdk packages/core/src/plugins/storage packages/core/src/plugins/session packages/core/tests/storage/session-tree-store.test.ts
git commit -m "feat(core): tree-backed SessionStore and SessionProvider.appendMessage"
```

---

### Task 5: 抽取 requestApproval 审批流辅助函数

**Files:**
- Create: `packages/core/src/execute/request-approval.ts`
- Test: `packages/core/tests/execute/request-approval.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/execute/request-approval.test.ts
import { describe, it, expect } from 'vitest';
import { AgentState } from '../../src/agent-state.js';
import { requestApproval } from '../../src/execute/request-approval.js';
import type { AgentStreamEvent } from '../../src/types.js';

describe('requestApproval', () => {
  it('emits request/resolved events and resolves with the decision', async () => {
    const agentState = new AgentState();
    const events: AgentStreamEvent[] = [];
    const promise = requestApproval({
      agentState,
      sessionId: 's1',
      input: {
        toolCallId: 'tc1', toolName: 'bash', patterns: ['bash:ls'],
        alwaysOptions: [],
      },
      emit: (e) => events.push(e),
    });
    const liveState = agentState.getOrCreate('s1');
    const request = liveState.pendingApprovals[0];
    expect(request).toBeDefined();
    liveState.approvalEngine.resolve(request.approvalId, 'allow-once');
    const resolution = await promise;
    expect(resolution.decision).toBe('allow-once');
    expect(events.map((e) => e.type)).toEqual(['approval-request', 'approval-resolved']);
    expect(liveState.pendingApprovals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- request-approval`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**（逻辑从 `execute/execute-tools.ts:54-78` 的 ask 分支原样抽取）

```typescript
// packages/core/src/execute/request-approval.ts
import type { AgentState } from '../agent-state.js';
import type { AgentStreamEvent } from '../types.js';
import type { CreateApprovalInput, ApprovalResolution } from './approval-engine.js';
import { log } from '../shared/debug-log.js';

export interface RequestApprovalParams {
  agentState: AgentState;
  sessionId: string;
  input: CreateApprovalInput;
  emit: (event: AgentStreamEvent) => void;
}

export async function requestApproval(params: RequestApprovalParams): Promise<ApprovalResolution> {
  const { agentState, sessionId, input, emit } = params;
  const liveState = agentState.getOrCreate(sessionId);
  const request = liveState.approvalEngine.createRequest(input);

  liveState.pendingApprovals.push(request);
  emit({ type: 'approval-request', sessionId, request });
  log('tools', 'approval requested', { sessionId, toolCallId: input.toolCallId, approvalId: request.approvalId });

  const resolution = await liveState.approvalEngine.wait(request.approvalId);

  liveState.pendingApprovals = liveState.pendingApprovals.filter((r) => r.approvalId !== request.approvalId);
  emit({ type: 'approval-resolved', sessionId, approvalId: request.approvalId, decision: resolution.decision });
  log('tools', 'approval resolved', { sessionId, toolCallId: input.toolCallId, approvalId: request.approvalId, decision: resolution.decision });

  return resolution;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- request-approval`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/execute/request-approval.ts packages/core/tests/execute/request-approval.test.ts
git commit -m "refactor(core): extract requestApproval flow from execute-tools"
```

---

### Task 6: tool-bridge（rem ToolProvider → pi AgentTool + beforeToolCall 审批）

**Files:**
- Create: `packages/core/src/run-agent/tool-bridge.ts`
- Test: `packages/core/tests/run-agent/tool-bridge.test.ts`

注意：`computeOutsideAllowed` 与 outside-workspace 处理逻辑从 `execute-tools.ts` 复制（Task 12 才删 execute-tools.ts，短暂重复可接受）。

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/run-agent/tool-bridge.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createToolBridge } from '../../src/run-agent/tool-bridge.js';
import { AgentState } from '../../src/agent-state.js';

const baseParams = (overrides: Record<string, unknown> = {}) => ({
  toolProvider: {
    getToolDefinition: vi.fn(() => ({ name: 'echo', description: 'd', parameters: Type.Object({}) })),
    execute: vi.fn(async () => [{ toolCallId: 'tc1', toolName: 'echo', output: 'ok' }]),
    getToolSet: () => [], register: () => {}, isDangerous: () => false,
  },
  permissionEvaluator: { evaluate: vi.fn(async () => ({ action: 'allow' })) },
  agentState: new AgentState(),
  ruleEngine: { addRule: vi.fn(), checkOutsideAllowed: () => false },
  ruleStore: { saveApproved: vi.fn(async () => {}) },
  securityMode: 'auto' as const,
  workspaceRoot: '/tmp',
  sessionId: 's1',
  emit: () => {},
  ...overrides,
});

const toolCallCtx = (args: unknown = {}) => ({
  assistantMessage: {} as never,
  toolCall: { type: 'toolCall' as const, id: 'tc1', name: 'echo', arguments: args },
  args,
  context: {} as never,
});

describe('createToolBridge.beforeToolCall', () => {
  it('blocks when permission denied', async () => {
    const params = baseParams();
    params.permissionEvaluator.evaluate = vi.fn(async () => ({ action: 'deny', reason: 'no' }));
    const bridge = createToolBridge(params as never);
    const result = await bridge.beforeToolCall(toolCallCtx() as never);
    expect(result).toEqual({ block: true, reason: 'no' });
  });

  it('blocks unknown tools', async () => {
    const params = baseParams();
    (params.toolProvider.getToolDefinition as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const bridge = createToolBridge(params as never);
    expect(await bridge.beforeToolCall(toolCallCtx() as never)).toEqual({ block: true, reason: 'unknown tool: echo' });
  });

  it('allows when permission allows', async () => {
    const bridge = createToolBridge(baseParams() as never);
    expect(await bridge.beforeToolCall(toolCallCtx() as never)).toBeUndefined();
  });
});

describe('createToolBridge AgentTool.execute', () => {
  it('maps ToolResult to AgentToolResult', async () => {
    const bridge = createToolBridge(baseParams() as never);
    const tool = bridge.tools.find((t) => t.name === 'echo')!;
    const result = await tool.execute('tc1', {} as never);
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('throws when the tool result carries an error', async () => {
    const params = baseParams();
    params.toolProvider.execute = vi.fn(async () => [{ toolCallId: 'tc1', toolName: 'echo', output: '', error: 'boom' }]);
    const bridge = createToolBridge(params as never);
    await expect(bridge.tools[0].execute('tc1', {} as never)).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- tool-bridge`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
// packages/core/src/run-agent/tool-bridge.ts
import type { AgentTool, BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { Static, TObject } from '@sinclair/typebox';
import type { AgentStreamEvent } from '../types.js';
import type { ToolProvider, ToolContext, ToolCall } from '../sdk/tool-provider.js';
import type { ToolPermissionEvaluator } from '../security/permissions/types.js';
import type { SecurityMode } from '../security/permissions/factory.js';
import type { RuleStorage } from '../sdk/storage-provider.js';
import type { AgentState } from '../agent-state.js';
import type { RuleEngine } from '../security/rules/rule-engine.js';
import { WorkspaceOutsideError } from '../security/workspace-outside-error.js';
import { classifyTool } from '../security/permissions/tool-classifier.js';
import { requestApproval } from '../execute/request-approval.js';

export interface ToolBridgeParams {
  toolProvider: ToolProvider;
  permissionEvaluator: ToolPermissionEvaluator;
  agentState: AgentState;
  ruleEngine: RuleEngine;
  ruleStore: RuleStorage;
  securityMode: SecurityMode;
  workspaceRoot: string;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
  signal?: AbortSignal;
  emit: (event: AgentStreamEvent) => void;
}

export interface ToolBridge {
  tools: AgentTool[];
  beforeToolCall: (context: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined>;
}

export function createToolBridge(params: ToolBridgeParams): ToolBridge {
  const { toolProvider, permissionEvaluator, agentState, ruleEngine, ruleStore, sessionId, emit } = params;

  const beforeToolCall = async (context: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    const toolName = context.toolCall.name;
    const def = toolProvider.getToolDefinition(toolName);
    if (!def) return { block: true, reason: `unknown tool: ${toolName}` };

    const call: ToolCall = { toolCallId: context.toolCall.id, toolName, input: context.args };
    const decision = await permissionEvaluator.evaluate(call, def);

    if (decision.action === 'deny') return { block: true, reason: decision.reason };

    if (decision.action === 'ask') {
      const resolution = await requestApproval({ agentState, sessionId, input: decision.request, emit });
      if (resolution.decision === 'deny') return { block: true, reason: 'denied' };
      if (resolution.decision === 'allow-always' && resolution.rule) {
        await ruleStore.saveApproved(resolution.rule);
        ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
      }
    }
    return undefined;
  };

  const executeOne = async (toolCallId: string, toolName: string, input: unknown) => {
    const def = toolProvider.getToolDefinition(toolName);
    if (!def) throw new Error(`unknown tool: ${toolName}`);

    const derivedPatterns = def.derivePatterns ? def.derivePatterns(input as never) : [`tool:${toolName}`];
    const category = classifyTool(toolName, def, derivedPatterns);
    const outsideAllowed =
      ruleEngine.checkOutsideAllowed(toolName, derivedPatterns) ||
      (params.securityMode === 'auto' && category === 'read');

    const ctx: ToolContext = {
      cwd: params.workspaceRoot, workspaceRoot: params.workspaceRoot,
      signal: params.signal, agentName: params.agentName, readOnly: params.readOnly,
      sessionId, toolCallId, outsideAllowed,
    };

    const call: ToolCall = { toolCallId, toolName, input };
    try {
      const [result] = await toolProvider.execute([call], ctx);
      return result;
    } catch (err) {
      if (err instanceof WorkspaceOutsideError) {
        return handleOutsideWorkspace(call, err, params, ctx, category);
      }
      throw err;
    }
  };

  const tools: AgentTool[] = toolProvider.getToolSet().map((piTool) => ({
    name: piTool.name,
    description: piTool.description,
    parameters: piTool.parameters,
    label: piTool.name,
    execute: async (toolCallId, input) => {
      const result = await executeOne(toolCallId, piTool.name, input);
      if (result.error) throw new Error(result.error);
      return {
        content: [{ type: 'text' as const, text: result.output ?? '' }],
        details: result.details,
      };
    },
  }));

  return { tools, beforeToolCall };
}

async function handleOutsideWorkspace(
  call: ToolCall,
  err: WorkspaceOutsideError,
  params: ToolBridgeParams,
  ctx: ToolContext,
  category: ReturnType<typeof classifyTool>,
) {
  if (params.securityMode === 'auto' && category === 'write') {
    const [result] = await params.toolProvider.execute([call], { ...ctx, outsideAllowed: true });
    return result;
  }
  if (params.securityMode === 'auto') {
    return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `Path outside workspace denied in auto mode: ${err.absolutePath}` };
  }

  const resolution = await requestApproval({
    agentState: params.agentState,
    sessionId: params.sessionId,
    input: {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      patterns: [err.absolutePath],
      title: `Access outside workspace: ${call.toolName}`,
      description: `Path "${err.absolutePath}" resolves outside workspace root "${err.workspaceRoot}"`,
      severity: 'warning',
      alwaysOptions: [
        { label: err.absolutePath, rule: { permission: call.toolName, pattern: err.absolutePath, action: 'allow', outside: true } },
        { label: `allow all outside ${call.toolName}`, rule: { permission: call.toolName, pattern: '**', action: 'allow', outside: true } },
      ],
    },
    emit: params.emit,
  });

  if (resolution.decision === 'deny') {
    return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: 'denied' };
  }
  if (resolution.decision === 'allow-always' && resolution.rule) {
    await params.ruleStore.saveApproved(resolution.rule);
    params.ruleEngine.addRule({ ...resolution.rule, source: 'approved' });
  }
  const [result] = await params.toolProvider.execute([call], { ...ctx, outsideAllowed: true });
  return result;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- tool-bridge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/run-agent/tool-bridge.ts packages/core/tests/run-agent/tool-bridge.test.ts
git commit -m "feat(core): add tool-bridge mapping rem tools to pi AgentTool with hook approval"
```

---

### Task 7: event-bridge（pi AgentEvent → rem AgentStreamEvent）

**Files:**
- Create: `packages/core/src/run-agent/event-bridge.ts`
- Test: `packages/core/tests/run-agent/event-bridge.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/run-agent/event-bridge.test.ts
import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import { createEventBridge } from '../../src/run-agent/event-bridge.js';
import { AgentEventStreamController } from '../../src/stream/agent-event-stream.js';
import type { AgentStreamEvent } from '../../src/types.js';

const usage: Usage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (text: string): AssistantMessage => ({
  role: 'assistant', content: [{ type: 'text', text }], api: 'faux', provider: 'faux', model: 'faux-1',
  usage, stopReason: 'stop', timestamp: 1,
});

const setup = () => {
  const controller = new AgentEventStreamController();
  const events: AgentStreamEvent[] = [];
  const orig = controller.emit.bind(controller);
  controller.emit = (e: AgentStreamEvent) => { events.push(e); orig(e); };
  const bridge = createEventBridge({ controller });
  return { events, bridge };
};

describe('createEventBridge', () => {
  it('maps turn/message lifecycle to step/message meta events', () => {
    const { events, bridge } = setup();
    bridge.listener({ type: 'turn_start' });
    bridge.listener({ type: 'message_start', message: assistant('hi') });
    expect(events[0]).toEqual({ type: 'step-start', step: 1 });
    expect(events[1].type).toBe('message-start');
    expect((events[1] as { messageId: string }).messageId).toBeTruthy();
  });

  it('passes assistantMessageEvent through on message_update', () => {
    const { events, bridge } = setup();
    const partial = assistant('h');
    const delta = { type: 'text_delta' as const, contentIndex: 0, delta: 'h', partial };
    bridge.listener({ type: 'message_update', message: partial, assistantMessageEvent: delta });
    expect(events[0]).toBe(delta);
  });

  it('maps tool_execution_end to tool-result and accumulates usage on turn_end', () => {
    const { events, bridge } = setup();
    bridge.listener({ type: 'message_start', message: assistant('') });
    bridge.listener({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'echo', result: { content: [{ type: 'text', text: 'out' }] }, isError: false });
    bridge.listener({ type: 'turn_end', message: assistant('done'), toolResults: [] });
    expect(events.find((e) => e.type === 'tool-result')).toEqual({ type: 'tool-result', toolCallId: 'tc1', toolName: 'echo', output: 'out', error: undefined });
    expect(events[events.length - 1]).toEqual({ type: 'step-finish', step: 1 });
    expect(bridge.getTotalUsage().totalTokens).toBe(3);
    expect(bridge.getLastAssistantMessage()?.stopReason).toBe('stop');
    expect(bridge.getCurrentMessageId()).toBeTruthy();
    expect(bridge.idOf(assistant('x'))).toBeUndefined();
  });

  it('marks tool errors in tool-result', () => {
    const { events, bridge } = setup();
    bridge.listener({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'echo', result: { content: [{ type: 'text', text: 'bad' }] }, isError: true });
    expect(events[0]).toEqual({ type: 'tool-result', toolCallId: 'tc1', toolName: 'echo', output: 'bad', error: 'bad' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- event-bridge`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
// packages/core/src/run-agent/event-bridge.ts
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import type { AgentEventStreamController } from '../stream/agent-event-stream.js';
import { generateId } from '../shared/generate-id.js';

export interface EventBridgeParams {
  controller: AgentEventStreamController;
}

export interface EventBridge {
  listener: (event: AgentEvent) => void;
  idOf: (message: Message) => string | undefined;
  getCurrentMessageId: () => string | undefined;
  getTotalUsage: () => Usage;
  getLastAssistantMessage: () => AssistantMessage | undefined;
}

const emptyUsage = (): Usage => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const addUsage = (acc: Usage, u: Usage): void => {
  acc.input += u.input; acc.output += u.output;
  acc.cacheRead += u.cacheRead; acc.cacheWrite += u.cacheWrite;
  acc.totalTokens += u.totalTokens;
  acc.cost.input += u.cost.input; acc.cost.output += u.cost.output;
  acc.cost.cacheRead += u.cost.cacheRead; acc.cost.cacheWrite += u.cost.cacheWrite;
  acc.cost.total += u.cost.total;
};

const toolResultText = (result: unknown): string => {
  const r = result as { content?: { type: string; text?: string }[] } | undefined;
  return (r?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
};

export function createEventBridge(params: EventBridgeParams): EventBridge {
  const { controller } = params;
  const messageIds = new WeakMap<Message, string>();
  let currentMessageId: string | undefined;
  let step = 0;
  const totalUsage = emptyUsage();
  let lastAssistant: AssistantMessage | undefined;

  const listener = (event: AgentEvent): void => {
    switch (event.type) {
      case 'turn_start':
        step += 1;
        controller.emit({ type: 'step-start', step });
        break;
      case 'message_start':
        if (event.message.role === 'assistant') {
          currentMessageId = generateId();
          messageIds.set(event.message, currentMessageId);
          controller.emit({ type: 'message-start', step, messageId: currentMessageId });
        }
        break;
      case 'message_update':
        controller.emit(event.assistantMessageEvent);
        break;
      case 'tool_execution_end': {
        const output = toolResultText(event.result);
        controller.emit({
          type: 'tool-result', toolCallId: event.toolCallId, toolName: event.toolName,
          output, error: event.isError ? output || 'tool execution failed' : undefined,
        });
        break;
      }
      case 'turn_end':
        if (event.message.role === 'assistant') {
          addUsage(totalUsage, event.message.usage);
          lastAssistant = event.message;
          messageIds.set(event.message, currentMessageId ?? generateId());
        }
        controller.emit({ type: 'step-finish', step });
        break;
    }
  };

  return {
    listener,
    idOf: (message) => messageIds.get(message),
    getCurrentMessageId: () => currentMessageId,
    getTotalUsage: () => totalUsage,
    getLastAssistantMessage: () => lastAssistant,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- event-bridge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/run-agent/event-bridge.ts packages/core/tests/run-agent/event-bridge.test.ts
git commit -m "feat(core): add event-bridge mapping pi AgentEvent to rem stream events"
```

---

### Task 8: session-writer（事件驱动增量持久化）

**Files:**
- Create: `packages/core/src/run-agent/session-writer.ts`
- Test: `packages/core/tests/run-agent/session-writer.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/run-agent/session-writer.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { createSessionWriter } from '../../src/run-agent/session-writer.js';
import type { Session } from '../../src/session.js';

const session: Session = {
  sessionId: 's1', conversation: [], currentTurn: 0,
  metadata: { schemaVersion: 2 }, createdAt: new Date(), updatedAt: new Date(),
};

describe('createSessionWriter', () => {
  it('persists messages on message_end with the bridged messageId', async () => {
    const appendMessage = vi.fn(async () => {});
    const writer = createSessionWriter({
      sessionProvider: { appendMessage } as never,
      session,
      idOf: () => 'mid-1',
    });
    const message: Message = { role: 'user', content: 'hi', timestamp: 1 };
    await writer({ type: 'message_end', message });
    expect(appendMessage).toHaveBeenCalledWith(session, message, 'mid-1');
  });

  it('generates an id when the message is unknown to the event bridge', async () => {
    const appendMessage = vi.fn(async () => {});
    const writer = createSessionWriter({
      sessionProvider: { appendMessage } as never,
      session,
      idOf: () => undefined,
    });
    await writer({ type: 'message_end', message: { role: 'user', content: 'hi', timestamp: 1 } });
    expect((appendMessage.mock.calls[0][2] as string).length).toBeGreaterThan(0);
  });

  it('ignores non message_end events', async () => {
    const appendMessage = vi.fn(async () => {});
    const writer = createSessionWriter({ sessionProvider: { appendMessage } as never, session, idOf: () => undefined });
    await writer({ type: 'turn_start' });
    expect(appendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- session-writer`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
// packages/core/src/run-agent/session-writer.ts
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { Session } from '../session.js';
import { generateId } from '../shared/generate-id.js';

export interface SessionWriterParams {
  sessionProvider: SessionProvider;
  session: Session;
  idOf: (message: Message) => string | undefined;
}

export function createSessionWriter(params: SessionWriterParams): (event: AgentEvent) => Promise<void> {
  const { sessionProvider, session, idOf } = params;
  return async (event: AgentEvent) => {
    if (event.type !== 'message_end') return;
    await sessionProvider.appendMessage(session, event.message, idOf(event.message) ?? generateId());
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- session-writer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/run-agent/session-writer.ts packages/core/tests/run-agent/session-writer.test.ts
git commit -m "feat(core): add session-writer for incremental tree persistence"
```

---

### Task 9: context-bridge（transformContext 压缩挂载点）

**Files:**
- Create: `packages/core/src/run-agent/context-bridge.ts`
- Test: `packages/core/tests/run-agent/context-bridge.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/run-agent/context-bridge.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { createContextBridge } from '../../src/run-agent/context-bridge.js';

const msg = (text: string): Message => ({ role: 'user', content: text, timestamp: 1 });

const baseParams = (overrides: Record<string, unknown> = {}) => ({
  compressor: { compress: vi.fn(async (msgs: Message[]) => msgs.slice(-1)) },
  shouldCompress: () => true,
  estimatedTokens: () => 100,
  threshold: () => 50,
  archive: vi.fn(async () => 'arc-1'),
  emit: () => {},
  sessionId: 's1',
  ...overrides,
});

describe('createContextBridge', () => {
  it('compresses once and appends post-compression messages on later turns', async () => {
    const params = baseParams();
    const events: { type: string }[] = [];
    params.emit = (e: { type: string }) => events.push(e);
    const bridge = createContextBridge(params as never);

    const first = await bridge.transformContext([msg('a'), msg('b'), msg('c')]);
    expect(first.map((m) => (m as Message).content)).toEqual(['c']);

    const second = await bridge.transformContext([msg('a'), msg('b'), msg('c'), msg('d')]);
    expect(second.map((m) => (m as Message).content)).toEqual(['c', 'd']);
    expect(params.compressor.compress).toHaveBeenCalledTimes(1);
    expect(params.archive).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(['compress-start', 'compress-end']);
  });

  it('passes messages through when shouldCompress is false', async () => {
    const params = baseParams({ shouldCompress: () => false });
    const bridge = createContextBridge(params as never);
    const result = await bridge.transformContext([msg('a')]);
    expect(result).toHaveLength(1);
    expect(params.compressor.compress).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- context-bridge`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
// packages/core/src/run-agent/context-bridge.ts
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { ContextCompressor } from '../sdk/compressor.js';
import type { AgentStreamEvent } from '../types.js';

export interface ContextBridgeParams {
  compressor: ContextCompressor;
  shouldCompress: (messages: Message[]) => boolean;
  estimatedTokens: () => number;
  threshold: () => number;
  archive: (before: Message[], after: Message[]) => Promise<string>;
  emit: (event: AgentStreamEvent) => void;
  sessionId: string;
}

export interface ContextBridge {
  transformContext: (messages: AgentMessage[]) => Promise<AgentMessage[]>;
}

export function createContextBridge(params: ContextBridgeParams): ContextBridge {
  let compressedBase: Message[] | null = null;
  let compressedAtCount = 0;

  const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    if (!compressedBase) {
      const asMessages = messages as Message[];
      if (!params.shouldCompress(asMessages)) return messages;
      params.emit({ type: 'compress-start', sessionId: params.sessionId, estimatedTokens: params.estimatedTokens(), threshold: params.threshold() });
      const compressed = await params.compressor.compress(asMessages);
      const removedCount = asMessages.length - compressed.length;
      const archiveId = await params.archive(asMessages, compressed);
      compressedBase = compressed;
      compressedAtCount = asMessages.length;
      params.emit({ type: 'compress-end', sessionId: params.sessionId, archiveId, removedMessageCount: removedCount });
      return compressed;
    }
    return [...compressedBase, ...messages.slice(compressedAtCount)];
  };

  return { transformContext };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- context-bridge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/run-agent/context-bridge.ts packages/core/tests/run-agent/context-bridge.test.ts
git commit -m "feat(core): add context-bridge mounting compression on transformContext"
```

---

### Task 10: pi-agent-factory（构造 pi Agent）

**Files:**
- Create: `packages/core/src/run-agent/pi-agent-factory.ts`
- Test: `packages/core/tests/run-agent/pi-agent-factory.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/run-agent/pi-agent-factory.test.ts
import { describe, it, expect } from 'vitest';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import type { AgentEvent, AgentTool } from '@earendil-works/pi-agent-core';
import { createPiAgent } from '../../src/run-agent/pi-agent-factory.js';
import { createCoreModels } from '../../src/llm/models.js';
import type { AgentDI } from '../../src/agent-di.js';

const setup = (responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]) => {
  const handle = fauxProvider();
  handle.setResponses(responses);
  const models = createCoreModels({ customProviders: [handle.provider] });
  return { handle, models };
};

const factoryParams = (models: ReturnType<typeof createCoreModels>, overrides: Record<string, unknown> = {}) => ({
  di: { models } as AgentDI,
  effectiveModel: { provider: 'faux', model: 'faux-1', apiKey: '', baseURL: undefined, reasoning: undefined },
  systemPrompt: 'sys',
  messages: [],
  tools: [] as AgentTool[],
  beforeToolCall: async () => undefined,
  transformContext: async (m: never[]) => m,
  maxTurns: 10,
  ...overrides,
});

describe('createPiAgent', () => {
  it('runs a prompt to completion with the faux provider', async () => {
    const { models } = setup([fauxAssistantMessage('hello')]);
    const agent = createPiAgent(factoryParams(models) as never);
    const events: string[] = [];
    agent.subscribe((e: AgentEvent) => { events.push(e.type); });
    await agent.prompt('hi');
    expect(events).toContain('agent_start');
    expect(events).toContain('message_end');
    expect(events[events.length - 1]).toBe('agent_end');
  });

  it('aborts after maxTurns when the model keeps requesting tools', async () => {
    const echo: AgentTool = {
      name: 'echo', description: 'd', label: 'echo',
      parameters: { type: 'object', properties: {} } as never,
      execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: undefined }),
    };
    const { models } = setup([
      () => fauxAssistantMessage([fauxToolCall('echo', {})], { stopReason: 'toolUse' }),
    ]);
    const agent = createPiAgent(factoryParams(models, { tools: [echo], maxTurns: 2 }) as never);
    await agent.prompt('go');
    const turns = agent.state.messages.filter((m) => m.role === 'assistant').length;
    expect(turns).toBeLessThanOrEqual(3);
  });
});
```

注意：faux provider 的 `setResponses` 用 factory 时按 `callCount` 每次取最后一个 factory 反复生成（读 faux 源码确认：responses 用尽后复用最后一项；若不是则用 `appendResponses` 多次）。实现时若 abort 测试行为不符，改为 `handle.appendResponses([...Array(5)].map(() => () => fauxAssistantMessage([fauxToolCall('echo', {})], { stopReason: 'toolUse' })))`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- pi-agent-factory`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
// packages/core/src/run-agent/pi-agent-factory.ts
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentOptions, AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentDI } from '../agent-di.js';
import type { ResolvedModelConfig } from '../sdk/config-provider.js';

export interface PiAgentFactoryParams {
  di: AgentDI;
  effectiveModel: ResolvedModelConfig;
  systemPrompt: string;
  messages: Message[];
  tools: AgentTool[];
  beforeToolCall: NonNullable<AgentOptions['beforeToolCall']>;
  transformContext: NonNullable<AgentOptions['transformContext']>;
  maxTurns: number;
  signal?: AbortSignal;
}

export function createPiAgent(params: PiAgentFactoryParams): Agent {
  const { di, effectiveModel } = params;
  const model = di.models.getModel(effectiveModel.provider, effectiveModel.model);
  if (!model) throw new Error(`Unknown model: ${effectiveModel.provider}/${effectiveModel.model}`);

  const streamFn: StreamFn = (m, context, options) =>
    di.models.streamSimple(m, context, {
      ...options,
      thinkingEnabled: true,
      apiKey: effectiveModel.apiKey || undefined,
      baseURL: effectiveModel.baseURL || undefined,
    });

  const agent = new Agent({
    initialState: {
      systemPrompt: params.systemPrompt,
      model,
      thinkingLevel: effectiveModel.reasoning ?? 'off',
      tools: params.tools,
      messages: params.messages,
    },
    streamFn,
    getApiKey: () => effectiveModel.apiKey || undefined,
    beforeToolCall: params.beforeToolCall,
    transformContext: params.transformContext,
    toolExecution: 'sequential',
    steeringMode: 'all',
    followUpMode: 'one-at-a-time',
  });

  let turns = 0;
  agent.subscribe((event) => {
    if (event.type === 'turn_end') {
      turns += 1;
      if (turns >= params.maxTurns) void agent.abort();
    }
  });

  params.signal?.addEventListener('abort', () => { void agent.abort(); });

  return agent;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- pi-agent-factory`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/run-agent/pi-agent-factory.ts packages/core/tests/run-agent/pi-agent-factory.test.ts
git commit -m "feat(core): add pi-agent-factory constructing pi Agent from rem DI"
```

---

### Task 11: run-agent 重写（编排层）+ run-agent.ts 薄壳

**Files:**
- Create: `packages/core/src/run-agent/index.ts`
- Modify: `packages/core/src/run-agent.ts`（整体替换为 re-export）
- Test: `packages/core/tests/run-agent/run-agent.integration.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/run-agent/run-agent.integration.test.ts
import { describe, it, expect } from 'vitest';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { runAgent } from '../../src/run-agent.js';
import { createCoreModels } from '../../src/llm/models.js';
import { AgentState } from '../../src/agent-state.js';
import { InMemorySessionProvider } from '../../src/plugins/session/in-memory/index.js';
import type { AgentDI } from '../../src/agent-di.js';
import type { AgentStreamEvent } from '../../src/types.js';

const makeDi = (models: ReturnType<typeof createCoreModels>, sessionProvider: InMemorySessionProvider): AgentDI => ({
  configProvider: {
    getBehaviorConfig: () => ({ name: 'test', maxTurns: 5, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false }),
    getModelConfig: () => ({ provider: 'faux', model: 'faux-1', apiKey: '', baseURL: undefined }),
    getToolConfig: () => ({}), getMcpConfig: () => ({}),
    resolveAgent: () => ({ id: 'default', name: 'test', corePrompt: 'p' }),
  } as never,
  sessionProvider,
  budgetPolicy: { checkTurn: () => true, checkTimeout: () => true } as never,
  systemPromptAssembler: { assemble: async () => 'sys' } as never,
  contextProvider: { build: async (s: { conversation: unknown[] }) => ({ system: 'sys', messages: s.conversation }) } as never,
  compressor: { shouldCompress: () => false, compress: async (m: never[]) => m } as never,
  errorHandler: { classify: () => 'unknown', isRetryable: () => false } as never,
  titleProvider: { generateTitle: async () => undefined } as never,
  mcpManager: { connectAll: async () => [], closeAll: async () => {} } as never,
  toolProvider: { getToolSet: () => [], getToolDefinition: () => undefined, execute: async () => [], register: () => {}, isDangerous: () => false } as never,
  mcpProviders: [],
  skillProvider: { loadSkills: async () => [] } as never,
  storage: {
    todoStore: { getBySession: async () => [], replaceForSession: async (_s: string, t: unknown[]) => t },
    archiveStore: { save: async () => {}, get: async () => null, listBySession: async () => [], getLatest: async () => null },
    ruleStore: { loadAll: async () => [], loadBySource: async () => [], saveApproved: async () => {} },
  } as never,
  ruleEngine: { addRule: () => {}, checkOutsideAllowed: () => false } as never,
  permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) } as never,
  models,
});

describe('runAgent (pi Agent)', () => {
  it('streams events, persists messages, and returns output', async () => {
    const handle = fauxProvider();
    handle.setResponses([fauxAssistantMessage('final answer')]);
    const models = createCoreModels({ customProviders: [handle.provider] });
    const sessionProvider = new InMemorySessionProvider();
    const di = makeDi(models, sessionProvider);

    const { stream, output } = runAgent({
      input: { content: 'hi' },
      sessionId: 's1',
      di,
      runtimeConfig: { securityMode: 'auto', runtime: { platform: 'test', env: {} } } as never,
      agentState: new AgentState(),
    });

    const events: AgentStreamEvent[] = [];
    for await (const e of stream.fullStream) events.push(e);
    const result = await output;

    expect(result.completed).toBe(true);
    expect(result.content).toBe('final answer');
    expect(events.map((e) => e.type)).toContain('message-start');
    expect(events.map((e) => e.type)).toContain('step-finish');
    expect(events[events.length - 1].type).toBe('finish');

    const session = await sessionProvider.load('s1');
    expect(session!.conversation.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-core test -- run-agent.integration`
Expected: FAIL（`src/run-agent.js` 旧实现行为不同 / handle 不存在）

- [ ] **Step 3: 实现**

```typescript
// packages/core/src/run-agent/index.ts
import type { Message, Usage, AssistantMessage } from '@earendil-works/pi-ai';
import type { Agent } from '@earendil-works/pi-agent-core';
import type { UserInput, UserInputContent, AgentOutput, AgentStream, AgentStreamEvent } from '../types.js';
import type { PromptBuildContext } from '../sdk/system-prompt.js';
import type { Skill } from '../sdk/skill-provider.js';
import { EventBus } from '../events.js';
import type { Session } from '../session.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import { AgentEventStreamController } from '../stream/agent-event-stream.js';
import type { AgentDI } from '../agent-di.js';
import { DefaultToolComposer } from '../tool-composer.js';
import type { AgentRuntimeConfig } from '../agent-runtime-config.js';
import type { ArchiveRecord } from '../sdk/storage-provider.js';
import { resolveContextWindow } from '../llm/context-window.js';
import { generateId } from '../shared/generate-id.js';
import type { AgentState } from '../agent-state.js';
import { normalizeUsage, normalizeUsageDetail, type TokenUsageDetail } from '../token-usage.js';
import { log } from '../shared/debug-log.js';
import { OverlayToolProvider } from '../overlay-tool-provider.js';
import { DefaultTodoService } from '../todo/service.js';
import { createDelegateTaskToolDefinition, createDelegateTaskToolExecutor } from '../plugins/tool/builtin/delegate-task.js';
import { createTodoWriteToolDefinition, createTodoWriteToolExecutor } from '../plugins/tool/builtin/todo-write.js';
import { createToolBridge } from './tool-bridge.js';
import { createEventBridge } from './event-bridge.js';
import { createSessionWriter } from './session-writer.js';
import { createContextBridge } from './context-bridge.js';
import { createPiAgent } from './pi-agent-factory.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  agentState: AgentState;
  workspace?: string;
  workspaceRoot?: string;
  agent?: string;
}

export interface RunAgentHandle {
  steer: (content: UserInputContent) => void;
  followUp: (content: UserInputContent) => void;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
  handle: RunAgentHandle;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentEventStreamController();
  const stream = controller.stream;

  let agentResolve!: (agent: Agent) => void;
  const agentReady = new Promise<Agent>((resolve) => { agentResolve = resolve; });
  const toMessage = (content: UserInputContent): Message => ({ role: 'user', content, timestamp: Date.now() }) as Message;

  const handle: RunAgentHandle = {
    steer: (content) => { void agentReady.then((a) => a.steer(toMessage(content))).catch(() => {}); },
    followUp: (content) => { void agentReady.then((a) => a.followUp(toMessage(content))).catch(() => {}); },
  };

  const outputPromise = (async (): Promise<AgentOutput> => {
    const di = params.di;
    const runtimeConfig = params.runtimeConfig;
    const workspace = params.workspace ?? 'default';
    const configProvider = di.configProvider.forWorkspace?.(workspace) ?? di.configProvider;
    const behavior = configProvider.getBehaviorConfig();
    const modelConfig = configProvider.getModelConfig();
    const agentRole = configProvider.resolveAgent(params.agent);
    const effectiveModel = agentRole.model ?? modelConfig;
    const workspaceRoot = params.workspaceRoot ?? (params.workspace ? params.workspace : behavior.workspaceRoot);

    const sessionProvider = di.sessionProvider;
    let session = await sessionProvider.load(params.sessionId);
    if (!session) {
      session = {
        sessionId: params.sessionId, conversation: [], currentTurn: 0, metadata: { schemaVersion: 2 },
        createdAt: new Date(), updatedAt: new Date(),
      };
      await sessionProvider.save(session);
    }

    const events = new EventBus();
    const liveState = params.agentState.getOrCreate(params.sessionId);
    liveState.attachEvents(events);

    if (liveState.tokenUsage.totalTokens === 0) {
      const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
        normalizeUsageDetail(entry as TokenUsageDetail));
      if (history.length > 0) params.agentState.restoreTokenUsage(params.sessionId, history);
    }

    if (liveState.status !== 'running') liveState.start({ clearSnapshot: true });

    if (!di.budgetPolicy.checkTurn(liveState) || !di.budgetPolicy.checkTimeout(Date.now())) {
      const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
      controller.finish(output);
      return output;
    }

    forkTitleGeneration(session, di.titleProvider, controller, sessionProvider);

    try {
      const { messages } = await di.contextProvider.build(session, behavior.name);

      const effectiveToolProvider = new DefaultToolComposer().compose({
        toolProvider: di.toolProvider, mcpProviders: di.mcpProviders, skillProvider: di.skillProvider,
      });
      const toolProviderWithDelegate = new OverlayToolProvider(effectiveToolProvider);
      toolProviderWithDelegate.register(
        createDelegateTaskToolDefinition(),
        createDelegateTaskToolExecutor(di, runtimeConfig, params.agentState, workspace),
      );
      toolProviderWithDelegate.register(
        createTodoWriteToolDefinition(),
        createTodoWriteToolExecutor(new DefaultTodoService(di.storage.todoStore), (event) => params.agentState.publish(event), workspace),
      );

      const skills = await di.skillProvider.loadSkills().catch(() => [] as Skill[]);
      const tools = toolProviderWithDelegate.getToolSet().map((t) => ({ name: t.name, description: t.description }));

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

      const eventBridge = createEventBridge({ controller });
      const emit = (event: AgentStreamEvent) => controller.emit(event);

      const toolBridge = createToolBridge({
        toolProvider: toolProviderWithDelegate,
        permissionEvaluator: di.permissionEvaluator,
        agentState: params.agentState,
        ruleEngine: di.ruleEngine,
        ruleStore: di.storage.ruleStore,
        securityMode: runtimeConfig.securityMode,
        workspaceRoot,
        agentName: behavior.name,
        readOnly: behavior.readOnly,
        sessionId: params.sessionId,
        signal: params.signal,
        emit,
      });

      const historyForTokens = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
        normalizeUsageDetail(entry as TokenUsageDetail));
      const accumulated = historyForTokens.reduce((sum, entry) => sum + entry.totalTokens, 0);
      const maxTokens = resolveContextWindow(effectiveModel.provider, effectiveModel.model, runtimeConfig.runtime.env, di.models);
      const compressionCfg = configProvider.getCompressionConfig();
      const threshold = maxTokens * compressionCfg.thresholdRatio;

      const contextBridge = createContextBridge({
        compressor: di.compressor,
        shouldCompress: (msgs) => di.compressor.shouldCompress({ ...session!, conversation: msgs }),
        estimatedTokens: () => accumulated,
        threshold: () => threshold,
        archive: async (before, after) => {
          const previousArchive = await di.storage.archiveStore.getLatest(params.sessionId);
          const archiveId = generateId();
          const summaryText = after
            .filter((m) => m.role === 'user')
            .flatMap((m) => (typeof m.content === 'string' ? [m.content] : m.content.filter((p) => p.type === 'text').map((p) => p.text)))
            .find((text) => text.includes('[上下文压缩摘要]')) ?? '';
          const record: ArchiveRecord = {
            id: archiveId, sessionId: params.sessionId, compressedAt: new Date(),
            version: previousArchive ? previousArchive.version + 1 : 1,
            parentArchiveId: previousArchive?.id,
            conversationSnapshot: before, summary: summaryText,
            tokenUsageBefore: accumulated > 0 ? { totalTokens: accumulated, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } : undefined,
          };
          await di.storage.archiveStore.save(record);
          session!.metadata.compressionHistory = [
            ...((session!.metadata.compressionHistory as unknown[]) ?? []),
            { archiveId, version: record.version, compressedAt: new Date().toISOString(), removedMessageCount: before.length - after.length },
          ];
          await sessionProvider.save(session!);
          return archiveId;
        },
        emit,
        sessionId: params.sessionId,
      });

      const agent = createPiAgent({
        di, effectiveModel, systemPrompt, messages,
        tools: toolBridge.tools,
        beforeToolCall: (ctx) => toolBridge.beforeToolCall(ctx),
        transformContext: contextBridge.transformContext,
        maxTurns: behavior.maxTurns,
        signal: params.signal,
      });

      const writer = createSessionWriter({ sessionProvider, session, idOf: eventBridge.idOf });
      agent.subscribe(writer);
      agent.subscribe(eventBridge.listener);

      agentResolve(agent);

      const steerMessage = toMessage(params.input.content);
      await agent.prompt(steerMessage);

      const usage = eventBridge.getTotalUsage();
      liveState.addTokenUsage(usage);
      params.agentState.publishUsageChange(workspace, params.sessionId, liveState.tokenUsage);

      const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
        normalizeUsageDetail(entry as TokenUsageDetail));
      history.push({ ...usage, runAt: new Date(), turns: [usage] });
      session.metadata.tokenUsageHistory = history;

      const currentMessageId = eventBridge.getCurrentMessageId();
      if (currentMessageId) {
        const messageTokenUsage: Record<string, Usage> = {};
        for (const [key, value] of Object.entries(session.metadata.messageTokenUsage ?? {})) {
          messageTokenUsage[key] = normalizeUsage(value as Usage);
        }
        messageTokenUsage[currentMessageId] = usage;
        session.metadata.messageTokenUsage = messageTokenUsage;
      }

      session.currentTurn++;
      await sessionProvider.save(session);

      const finalMessage: AssistantMessage | undefined = eventBridge.getLastAssistantMessage();
      const content = finalMessage?.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text).join('') ?? '';
      const output: AgentOutput = { content, completed: true };
      controller.finish(output, finalMessage);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('compress') || message.includes('summary')) {
        controller.emit({ type: 'compress-error', sessionId: params.sessionId, error: message });
      }
      const output: AgentOutput = { content: `Error: ${message}`, completed: true };
      controller.fail(error instanceof Error ? error : new Error(message));
      params.agentState.publishSessionError(workspace, params.sessionId, message);
      await sessionProvider.save(session);
      return output;
    }
  })();

  return { stream, output: outputPromise, handle };
}

function forkTitleGeneration(
  session: Session,
  titleProvider: TitleProvider,
  controller: AgentEventStreamController,
  sessionProvider: SessionProvider,
): void {
  if (session.metadata.title) return;
  (async () => {
    try {
      const title = await titleProvider.generateTitle(session.conversation);
      if (title) {
        log('title', 'generated', { sessionId: session.sessionId, title });
        session.metadata.title = title;
        controller.pushTitle(title);
        await sessionProvider.save(session);
      }
    } catch {
      log('title', 'failed', { sessionId: session.sessionId });
    }
  })();
}
```

`packages/core/src/run-agent.ts` 整体替换为：

```typescript
export { runAgent } from './run-agent/index.js';
export type { RunAgentParams, RunAgentResult, RunAgentHandle } from './run-agent/index.js';
```

注意：`titleProvider.generateTitle(session.conversation)` 在用户消息尚未进 conversation 时与旧行为一致（旧实现先 push userMessage 再 forkTitle；新实现 title 生成读的是加载时的 conversation，可接受——title 只生成一次，best-effort）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter rem-agent-core test -- run-agent.integration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/run-agent packages/core/src/run-agent.ts packages/core/tests/run-agent/run-agent.integration.test.ts
git commit -m "feat(core): rewrite runAgent on pi Agent with tree persistence"
```

---

### Task 12: 删除旧循环与清理（loop-strategy / ReactLoop / reason / executeTools / loopStrategy DI）

**Files:**
- Delete: `packages/core/src/sdk/loop-strategy.ts`
- Delete: `packages/core/src/loop-strategy.ts`
- Delete: `packages/core/src/plugins/loop/`（整个目录）
- Delete: `packages/core/src/reason/reason.ts` 及 `packages/core/tests/reason/` 中 reason 相关测试（保留 generate 测试）
- Delete: `packages/core/src/execute/execute-tools.ts` 及对应测试 `packages/core/tests/execute/` 中 execute-tools 用例
- Modify: `packages/core/src/agent-di.ts`（删 `loopStrategy` 字段及 import）
- Modify: `packages/core/src/agent-context-assembler.ts`（删 ReactLoop 默认值与 import）
- Modify: `packages/core/src/sdk/session-provider.ts`（删 `addMessage`/`appendContent`）、两个实现类同步删除
- Modify: `packages/core/src/index.ts`（删 loop-strategy/reason 相关 export）
- Modify: `packages/core/src/plugins/index.ts`（删 loop export，若有）
- Modify: 旧测试 `packages/core/tests/run-agent*.test.ts`（4 个：run-agent / run-agent-custom / run-agent-runtime / run-agent-workspace-root）、`agent-context-assembler.test.ts`、`todowrite-registration.test.ts` 等引用 loopStrategy/addMessage 的测试

- [ ] **Step 1: 删除文件与字段**

执行上述删除。`agent-di.ts` 删除第 12 行 import 与第 31 行 `loopStrategy: LoopStrategy;`。`agent-context-assembler.ts` 删除 ReactLoop import 与 `loopStrategy: options?.loopStrategy ?? new ReactLoop()` 行。

- [ ] **Step 2: 修编译错误**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: 列出一批错误——逐个处理：
- mock DI 里多余的 `loopStrategy` 字段：删除该字段。
- `sessionProvider.addMessage/appendContent` mock：改为 `appendMessage: async () => {}`。
- 旧 run-agent 测试若断言已删除的 LoopContext 交互（`stream`/`execute` 闭包、`step-start` 计数等）：以 `tests/run-agent/run-agent.integration.test.ts` 为模板改写为 faux provider 驱动；纯测编排分支（budget 超限、title、错误路径）的用例保留，仅替换 DI mock。
- `reason()` 的引用（`src/index.ts` re-export、测试）：删除。

- [ ] **Step 3: 全量回归**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿（含 bridge/routes/ui 包）

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(core): remove ReactLoop, LoopStrategy, reason() and executeTools"
```

---

### Task 13: bridge 暴露 steer/followUp + routes

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Modify: `packages/bridge/src/agent-service.interface.ts`
- Modify: `packages/bridge/src/agent-remote-service.ts`
- Modify: `packages/routes/src/handlers/agent.ts`
- Test: `packages/bridge/tests/steer-follow-up.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/bridge/tests/steer-follow-up.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentService } from '../src/agent.js';
import { ServiceError } from '../src/errors.js';

const makeService = () => {
  const di = {
    storage: { workspaceStore: {}, todoStore: {} },
    sessionProvider: {},
    ruleEngine: {},
  } as never;
  const runtimeConfig = {} as never;
  return new AgentService(di, runtimeConfig);
};

describe('AgentService steer/followUp', () => {
  it('throws 409 when session is not running', async () => {
    const service = makeService();
    await expect(service.steer('ws', 's1', 'hello')).rejects.toThrow(ServiceError);
    await expect(service.followUp('ws', 's1', 'hello')).rejects.toThrow(ServiceError);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter rem-agent-bridge test -- steer-follow-up`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现**

`agent-service.interface.ts` 追加：

```typescript
steer(workspace: string, sessionId: string, input: UserInputContent): Promise<void>;
followUp(workspace: string, sessionId: string, input: UserInputContent): Promise<void>;
```

`agent.ts`（AgentService）：
1. 新增字段 `private activeRuns = new Map<string, RunAgentHandle>();`（`import type { RunAgentHandle } from 'rem-agent-core';`）。
2. `run()` 中 `result = coreRunAgent({...})` 之后加 `this.activeRuns.set(sessionId, result.handle);`。
3. `drive()` 末尾（两个 finishRun 之后）加 `this.activeRuns.delete(sessionId);`。
4. 新增方法：

```typescript
async steer(_workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
  const handle = this.activeRuns.get(sessionId);
  if (!handle) throw new ServiceError('Session is not running', 409);
  handle.steer(input);
}

async followUp(_workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
  const handle = this.activeRuns.get(sessionId);
  if (!handle) throw new ServiceError('Session is not running', 409);
  handle.followUp(input);
}
```

`agent-remote-service.ts`（仿照 `interrupt` 的 fetch 模式）：

```typescript
async steer(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
  const response = await fetch(`${this.resolvedBaseUrl}${this.apiPrefix}/agent/steer?${AgentRemoteService.wsQuery(workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content: input }),
  });
  if (!response.ok) throw new Error(`Failed to steer: ${response.status}`);
}

async followUp(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
  const response = await fetch(`${this.resolvedBaseUrl}${this.apiPrefix}/agent/follow-up?${AgentRemoteService.wsQuery(workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content: input }),
  });
  if (!response.ok) throw new Error(`Failed to follow up: ${response.status}`);
}
```

`routes/src/handlers/agent.ts` 新增两个 handler 并注册（body 校验复用 runAgent 的 isEmpty 模式）：

```typescript
async function steerAgent({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { sessionId?: string; content?: UserInputContent };
  if (!body.sessionId || body.content === undefined || body.content === null ||
      (typeof body.content === 'string' && !body.content) ||
      (Array.isArray(body.content) && body.content.length === 0)) {
    return Response.json({ error: 'sessionId and content are required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  await service.steer(workspace, body.sessionId, body.content);
  return Response.json({ sessionId: body.sessionId, steered: true });
}

async function followUpAgent({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { sessionId?: string; content?: UserInputContent };
  if (!body.sessionId || body.content === undefined || body.content === null ||
      (typeof body.content === 'string' && !body.content) ||
      (Array.isArray(body.content) && body.content.length === 0)) {
    return Response.json({ error: 'sessionId and content are required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  await service.followUp(workspace, body.sessionId, body.content);
  return Response.json({ sessionId: body.sessionId, queued: true });
}
```

路由表追加：

```typescript
{ pattern: 'agent/steer', method: 'POST', handler: steerAgent },
{ pattern: 'agent/follow-up', method: 'POST', handler: followUpAgent },
```

若 `LocalAgentService`（`rem-agent-bridge/local`）也实现 `IAgentService`，同步加委托方法（实现时 grep `implements IAgentService` 全部补齐）。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `pnpm --filter rem-agent-bridge test -- steer-follow-up && pnpm typecheck && pnpm test`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/bridge packages/routes packages/core/src/run-agent/index.ts
git commit -m "feat(bridge,routes): expose steer and followUp for running sessions"
```

---

## Self-Review 结论

- **Spec 覆盖**：模块划分（T2-T11）、tree 存储+迁移（T2-T4）、错误处理语义（T6 block/异常→isError、T10 abort/maxTurns、T11 错误路径）、测试策略（各任务 TDD + T11 集成 + T13）、steer/followUp（T11 handle + T13 bridge/routes）、删除清单（T12）、依赖升级（T1）。✔
- **命名一致性**：`appendEntry/getActiveLeafId/listEntries`（T3/T4）、`appendMessage`（T4/T8）、`requestApproval`（T5/T6）、`createToolBridge/createEventBridge/createSessionWriter/createContextBridge/createPiAgent`（T6-T11）前后一致。✔
- **已知风险**（实现时注意）：faux provider responses 耗尽策略（T10 已注明备选写法）；`session-converter.ts` 的 `toSession` 签名调整（T4 已注明先读再改）；`LocalAgentService` 是否实现 `IAgentService`（T13 已注明 grep 补齐）。
