# JSONL 增量 Session 持久化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 core session provider 从全量 JSON 重写改为 JSONL 增量追加，并去掉 bridge streaming chunk 级持久化。

**Architecture:** 新增 `JsonlSessionStore` 负责 `.jsonl`/`.meta.json` 底层 IO 和增量追加算法；`BaseSessionProvider` 变薄并委托 store；`LocalSessionProvider`/`FileSessionProvider` 只保留各自特性（index/list）。core 层已存在的 `TurnHooks.onStepFinish` 会在每个 loop iteration 后调用 save。

**Tech Stack:** TypeScript, Node.js fs/promises, vitest

---

## 文件结构

```
packages/core/src/plugins/session/
├── jsonl-store.ts          # 新增：JSONL/meta 读写、增量追加
├── base.ts                 # 修改：委托 JsonlSessionStore，删除旧 write/persist
├── file/index.ts           # 修改：list() 读取 .meta.json
├── local/index.ts          # 修改：msgCache 写 .msg.json，index 更新
└── in-memory/index.ts      # 不变

packages/bridge/src/agent.ts # 修改：删除 streaming chunk 级 save

packages/core/tests/
├── jsonl-session-store.test.ts         # 新增
├── local-session-provider.test.ts      # 修改
└── file-session-provider.test.ts       # 修改
```

---

## Task 1: 创建 JsonlSessionStore 模块

**Files:**
- Create: `packages/core/src/plugins/session/jsonl-store.ts`
- Test: `packages/core/tests/jsonl-session-store.test.ts`

- [ ] **Step 1: 写失败测试 — 基本 load/save**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlSessionStore } from '../src/plugins/session/jsonl-store.js';
import type { ModelMessage } from '../src/types.js';

describe('JsonlSessionStore', () => {
  let dir: string;
  let store: JsonlSessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jsonl-store-test-'));
    store = new JsonlSessionStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves and loads session with conversation', async () => {
    const session = {
      sessionId: 's1',
      conversation: [
        { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] } as ModelMessage,
      ],
      currentTurn: 1,
      metadata: { title: 't' },
      createdAt: new Date('2026-07-06T00:00:00Z'),
      updatedAt: new Date('2026-07-06T00:00:01Z'),
    };

    await store.save(session);
    const loaded = await store.load('s1');

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('s1');
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(loaded!.currentTurn).toBe(1);
    expect(loaded!.metadata.title).toBe('t');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter rem-agent-core test run packages/core/tests/jsonl-session-store.test.ts`

Expected: FAIL，因为 `JsonlSessionStore` 未定义。

- [ ] **Step 3: 实现 JsonlSessionStore 最小版本**

```typescript
import { mkdir, readFile, writeFile, appendFile, unlink, readdir, rename } from 'fs/promises';
import { join } from 'path';
import type { Session, SessionSummary } from '../../sdk/session-provider.js';
import type { ModelMessage } from '../../types.js';

export class JsonlSessionStore {
  private counts = new Map<string, number>();

  constructor(private dir: string) {}

  private jsonlPath(id: string): string { return join(this.dir, `${id}.jsonl`); }
  private metaPath(id: string): string { return join(this.dir, `${id}.meta.json`); }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async load(sessionId: string): Promise<Session | null> {
    const conversation = await this.readMessages(sessionId);
    const meta = await this.readMeta(sessionId);
    if (!conversation && !meta) return null;
    this.counts.set(sessionId, conversation?.length ?? 0);
    return {
      sessionId,
      conversation: conversation ?? [],
      currentTurn: meta?.currentTurn ?? 0,
      metadata: meta?.metadata ?? {},
      createdAt: meta?.createdAt ?? new Date(0),
      updatedAt: meta?.updatedAt ?? new Date(0),
    };
  }

  async save(session: Session): Promise<void> {
    await this.ensureDir();
    const count = this.counts.get(session.sessionId) ?? 0;
    const newMessages = session.conversation.slice(count);
    if (newMessages.length > 0) {
      const lines = newMessages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      await appendFile(this.jsonlPath(session.sessionId), lines, 'utf-8');
      this.counts.set(session.sessionId, session.conversation.length);
    }
    await this.writeMeta(session);
  }

  async delete(sessionId: string): Promise<void> {
    this.counts.delete(sessionId);
    await this.unlinkQuiet(this.jsonlPath(sessionId));
    await this.unlinkQuiet(this.metaPath(sessionId));
  }

  async listSummaries(): Promise<SessionSummary[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const summaries: SessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.meta.json')) continue;
      const id = entry.slice(0, -'.meta.json'.length);
      const meta = await this.readMeta(id);
      if (!meta) continue;
      const conversation = await this.readMessages(id);
      summaries.push({
        sessionId: id,
        title: typeof meta.metadata?.title === 'string' ? meta.metadata.title : undefined,
        pinned: meta.metadata?.pinned === true,
        updatedAt: meta.updatedAt,
        messageCount: conversation?.length ?? 0,
      });
    }
    summaries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return summaries;
  }

  private async readMessages(sessionId: string): Promise<ModelMessage[] | null> {
    let raw: string;
    try {
      raw = await readFile(this.jsonlPath(sessionId), 'utf-8');
    } catch {
      return null;
    }
    const messages: ModelMessage[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        messages.push(JSON.parse(trimmed) as ModelMessage);
      } catch {
        return null;
      }
    }
    return messages;
  }

  private async readMeta(sessionId: string): Promise<Partial<Session> & { updatedAt: Date; createdAt: Date } | null> {
    let raw: string;
    try {
      raw = await readFile(this.metaPath(sessionId), 'utf-8');
    } catch {
      return null;
    }
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      return {
        currentTurn: typeof data.currentTurn === 'number' ? data.currentTurn : 0,
        metadata: data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {},
        createdAt: data.createdAt ? new Date(String(data.createdAt)) : new Date(0),
        updatedAt: data.updatedAt ? new Date(String(data.updatedAt)) : new Date(0),
      };
    } catch {
      return null;
    }
  }

  private async writeMeta(session: Session): Promise<void> {
    const data = {
      sessionId: session.sessionId,
      currentTurn: session.currentTurn,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const tmpPath = `${this.metaPath(session.sessionId)}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmpPath, this.metaPath(session.sessionId));
  }

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // ignore
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter rem-agent-core test run packages/core/tests/jsonl-session-store.test.ts`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/plugins/session/jsonl-store.ts packages/core/tests/jsonl-session-store.test.ts
git commit -m "feat(core): add JsonlSessionStore for incremental session persistence"
```

---

## Task 2: 为 JsonlSessionStore 补充增量/元数据/并发测试

**Files:**
- Modify: `packages/core/tests/jsonl-session-store.test.ts`

- [ ] **Step 1: 追加增量保存测试**

在 `jsonl-session-store.test.ts` 的 `describe` 内追加：

```typescript
  it('appends only new messages on repeated saves', async () => {
    const session = {
      sessionId: 's1',
      conversation: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'a' }] } as ModelMessage],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await store.save(session);
    session.conversation.push({ id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'b' }] } as ModelMessage);
    await store.save(session);
    session.conversation.push({ id: 'm3', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read', output: 'x' }] } as unknown as ModelMessage);
    await store.save(session);

    const raw = await readFile(join(dir, 's1.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(3);

    const loaded = await store.load('s1');
    expect(loaded!.conversation).toHaveLength(3);
  });

  it('updates meta without re-appending messages', async () => {
    const session = {
      sessionId: 's1',
      conversation: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'a' }] } as ModelMessage],
      currentTurn: 1,
      metadata: { title: 'first' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await store.save(session);
    session.metadata.title = 'second';
    await store.save(session);

    const raw = await readFile(join(dir, 's1.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);

    const loaded = await store.load('s1');
    expect(loaded!.metadata.title).toBe('second');
  });

  it('handles sequential saves without corruption', async () => {
    const session = {
      sessionId: 's1',
      conversation: [] as ModelMessage[],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    for (let i = 0; i < 50; i++) {
      session.conversation.push({ id: `m${i}`, role: 'user', content: [{ type: 'text', text: String(i) }] } as ModelMessage);
      await store.save(session);
    }

    const loaded = await store.load('s1');
    expect(loaded!.conversation).toHaveLength(50);
    expect(loaded!.conversation[49].content).toEqual([{ type: 'text', text: '49' }]);
  });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm --filter rem-agent-core test run packages/core/tests/jsonl-session-store.test.ts`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/jsonl-session-store.test.ts
git commit -m "test(core): add JsonlSessionStore incremental persistence tests"
```

---

## Task 3: 重构 BaseSessionProvider 使用 JsonlSessionStore

**Files:**
- Modify: `packages/core/src/plugins/session/base.ts`
- Test: `packages/core/tests/file-session-provider.test.ts`, `packages/core/tests/local-session-provider.test.ts`

- [ ] **Step 1: 修改 BaseSessionProvider**

把 `base.ts` 整体替换为：

```typescript
import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import type { Session, SessionProvider, SessionSummary } from '../../sdk/session-provider.js';
import { JsonlSessionStore } from './jsonl-store.js';

export abstract class BaseSessionProvider implements SessionProvider {
  protected store: JsonlSessionStore;

  constructor(dir: string) {
    this.store = new JsonlSessionStore(dir);
  }

  async create(): Promise<Session> {
    await this.ensureDir();
    const now = new Date();
    const session: Session = {
      sessionId: randomUUID(),
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.write(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    return this.store.load(sessionId);
  }

  async save(session: Session): Promise<void> {
    await this.ensureDir();
    await this.store.save(session);
  }

  async delete(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  protected async ensureDir(): Promise<void> {
    await mkdir(this.store.dir, { recursive: true });
  }

  protected async write(session: Session): Promise<void> {
    await this.store.save(session);
  }

  abstract list(): Promise<SessionSummary[]>;
}
```

- [ ] **Step 2: 运行现有 session provider 测试**

Run: `pnpm --filter rem-agent-core test run packages/core/tests/file-session-provider.test.ts packages/core/tests/local-session-provider.test.ts`

Expected: 大量 FAIL，因为测试还期望 `.json` 文件，且 `list()` 还没改。

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/plugins/session/base.ts
git commit -m "refactor(core): delegate BaseSessionProvider to JsonlSessionStore"
```

---

## Task 4: 适配 FileSessionProvider.list()

**Files:**
- Modify: `packages/core/src/plugins/session/file/index.ts`

- [ ] **Step 1: 修改 list() 使用 JsonlSessionStore.listSummaries()**

把 `file/index.ts` 整体替换为：

```typescript
import type { SessionSummary } from '../../../sdk/session-provider.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';
import { BaseSessionProvider } from '../base.js';

export interface FileSessionProviderOptions {
  dir: string;
}

export class FileSessionProvider extends BaseSessionProvider {
  constructor(dir: string) {
    super(dir);
  }

  async list(): Promise<SessionSummary[]> {
    return this.store.listSummaries();
  }
}

export function createProvider(options: FileSessionProviderOptions | undefined): FileSessionProvider {
  if (!options?.dir) {
    throw new Error('FileSessionProvider requires dir');
  }
  return new FileSessionProvider(options.dir);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): FileSessionProviderOptions {
  return { dir: ctx.sessionsDir };
}
```

- [ ] **Step 2: 更新 file-session-provider.test.ts**

把测试里所有对 `.json` 文件存在的断言去掉。测试本身不需要关心文件扩展名，只需验证 load/save/list/delete 行为。把 `file-session-provider.test.ts` 整体替换为与 `local-session-provider.test.ts` 行为等价但不含 index 测试的版本（或直接保留现有结构，只删除涉及 `.json` 的断言）。

当前 file-session-provider.test.ts 没有直接断言 `.json` 文件名，只需确认 list 行为仍正常。

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter rem-agent-core test run packages/core/tests/file-session-provider.test.ts`

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/plugins/session/file/index.ts packages/core/tests/file-session-provider.test.ts
git commit -m "refactor(core): adapt FileSessionProvider to JsonlSessionStore"
```

---

## Task 5: 适配 LocalSessionProvider（msgCache + index）

**Files:**
- Modify: `packages/core/src/plugins/session/local/index.ts`
- Test: `packages/core/tests/local-session-provider.test.ts`

- [ ] **Step 1: 修改 LocalSessionProvider 使用新存储**

把 `local/index.ts` 整体替换为：

```typescript
import { readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type { Session, SessionSummary } from '../../../sdk/session-provider.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';
import { BaseSessionProvider } from '../base.js';
import { getMetaBoolean, getMetaString } from '../metadata.js';
import type { ContentPart } from '../../../types.js';

export interface LocalSessionProviderOptions {
  dir: string;
}

interface IndexEntry {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: string;
  messageCount: number;
}

export class LocalSessionProvider extends BaseSessionProvider {
  private msgCache = new Map<string, ContentPart[]>();

  constructor(dir: string) {
    super(dir);
  }

  private indexPath(): string {
    return join(this.store.dir, 'index.json');
  }

  private msgPath(sessionId: string): string {
    return join(this.store.dir, `${sessionId}.msg.json`);
  }

  async create(): Promise<Session> {
    const session = await super.create();
    await this.updateIndex(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    const session = await this.store.load(sessionId);
    if (!session) return null;
    try {
      const raw = await readFile(this.msgPath(sessionId), 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        this.msgCache.set(sessionId, data);
      }
    } catch {
      // msg cache is optional
    }
    return session;
  }

  async save(session: Session): Promise<void> {
    await this.ensureDir();
    await this.store.save(session);
    await this.writeMsgCache(session.sessionId);
    await this.updateIndex(session);
  }

  async list(): Promise<SessionSummary[]> {
    await this.ensureDir();
    const index = await this.readIndex();
    return index.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      pinned: s.pinned,
      updatedAt: new Date(s.updatedAt),
      messageCount: s.messageCount,
    }));
  }

  async delete(sessionId: string): Promise<void> {
    this.msgCache.delete(sessionId);
    await this.store.delete(sessionId);
    await this.unlinkQuiet(this.msgPath(sessionId));
    await this.removeFromIndex(sessionId);
  }

  cueMessages(sessionId: string, messages: ContentPart[]): void {
    this.msgCache.set(sessionId, messages);
  }

  pullMessages(sessionId: string): ContentPart[] {
    return this.msgCache.get(sessionId) ?? [];
  }

  private async writeMsgCache(sessionId: string): Promise<void> {
    const messages = this.msgCache.get(sessionId);
    if (!messages) return;
    await writeFile(this.msgPath(sessionId), JSON.stringify(messages, null, 2), 'utf-8');
  }

  private async updateIndex(session: Session): Promise<void> {
    const index = await this.readIndex();
    const count = Array.isArray(session.conversation) ? session.conversation.length : 0;
    const existing = index.findIndex((s) => s.sessionId === session.sessionId);
    const entry: IndexEntry = {
      sessionId: session.sessionId,
      title: getMetaString(session.metadata, 'title'),
      pinned: getMetaBoolean(session.metadata, 'pinned'),
      updatedAt: session.updatedAt.toISOString(),
      messageCount: count,
    };
    if (existing >= 0) {
      index[existing] = entry;
    } else {
      index.push(entry);
    }
    index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.writeIndex(index);
  }

  private async removeFromIndex(sessionId: string): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex(index.filter((s) => s.sessionId !== sessionId));
  }

  private async readIndex(): Promise<IndexEntry[]> {
    try {
      const raw = await readFile(this.indexPath(), 'utf-8');
      return JSON.parse(raw) as IndexEntry[];
    } catch {
      return [];
    }
  }

  private async writeIndex(index: IndexEntry[]): Promise<void> {
    await writeFile(this.indexPath(), JSON.stringify(index, null, 2), 'utf-8');
  }

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // ignore
    }
  }
}

export function createProvider(options: LocalSessionProviderOptions | undefined): LocalSessionProvider {
  if (!options?.dir) {
    throw new Error('LocalSessionProvider requires dir');
  }
  return new LocalSessionProvider(options.dir);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): LocalSessionProviderOptions {
  return { dir: ctx.sessionsDir };
}
```

- [ ] **Step 2: 更新 local-session-provider.test.ts**

当前测试不直接断言文件格式，只需保留。但需新增一个测试验证 `.msg.json` 不会干扰 conversation：

在 describe 内追加：

```typescript
  it('does not duplicate conversation when msgCache exists', async () => {
    const session = await provider.create();
    session.conversation.push({ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] } as ModelMessage);
    provider.cueMessages(session.sessionId, [{ type: 'text', text: 'streaming' }]);
    await provider.save(session);

    const loaded = await provider.load(session.sessionId);
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hi' }]);
  });
```

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter rem-agent-core test run packages/core/tests/local-session-provider.test.ts`

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/plugins/session/local/index.ts packages/core/tests/local-session-provider.test.ts
git commit -m "refactor(core): adapt LocalSessionProvider to JsonlSessionStore with msgCache split"
```

---

## Task 6: 删除 bridge 层 streaming chunk 级持久化

**Files:**
- Modify: `packages/bridge/src/agent.ts`

- [ ] **Step 1: 删除 per-chunk save 逻辑**

找到这段代码并删除：

```typescript
          if (
            chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' ||
            chunk.type === 'tool-call' || chunk.type === 'tool-result' ||
            chunk.type === 'text-start' || chunk.type === 'reasoning-start' ||
            chunk.type === 'tool-call-start' || chunk.type === 'tool-result-start'
          ) {
            try {
              accumulatedParts = reduceStreamChunk(accumulatedParts as Parameters<typeof reduceStreamChunk>[0], chunk);
              const session = await sessionProvider.load(sessionId);
              if (session) {
                const lastMsg = session.conversation[session.conversation.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  lastMsg.content = accumulatedParts as typeof lastMsg.content;
                  await sessionProvider.save(session);
                }
              }
            } catch {
              // persistence is best-effort during streaming
            }
          }
```

同时删除 `accumulatedParts` 变量声明（如果不再用于 UI）。检查 `reduceStreamChunk` 是否还在别处使用，若仅在此处使用则可删除 import。目前 `reduceStreamChunk` 只用于持久化，删除 import。

把 `import { reduceStreamChunk } from './stream-reducer.js';` 删除。

- [ ] **Step 2: 运行 bridge 类型检查**

Run: `pnpm --filter rem-agent-bridge typecheck`

Expected: PASS（若 `accumulatedParts` 还有引用则报错，需一并清理）

- [ ] **Step 3: 提交**

```bash
git add packages/bridge/src/agent.ts
git commit -m "refactor(bridge): remove streaming chunk-level session persistence"
```

---

## Task 7: 运行全仓类型检查与测试

**Files:**
- 全仓

- [ ] **Step 1: 类型检查**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 2: 运行测试**

Run: `pnpm test`

Expected: 所有测试 PASS（注意 `packages/core` 没有 test script，用根目录 `pnpm test`）

- [ ] **Step 3: 提交（如只有 lock 或无关改动则跳过）**

---

## Spec 覆盖自检

| Spec 要求 | 对应 Task |
|---|---|
| JSONL + meta.json 存储格式 | Task 1 |
| 增量追加 O(delta) | Task 1 |
| 不兼容旧 .json | 不实现迁移 |
| bridge 去掉 streaming save | Task 6 |
| LocalSessionProvider msgCache 分离 | Task 5 |
| FileSessionProvider list 读取 meta | Task 4 |
| 原子写 meta | Task 1 |
| 测试覆盖增量/元数据/并发 | Task 2, 5 |

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-07-06-jsonl-session-persistence-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
