# JSONL 增量 Session 持久化设计

## 背景

当前 `packages/core/src/plugins/session/base.ts` 的 `save()` 每次都会把整段 `conversation` 用 `JSON.stringify` 后写入 `{sessionId}.json`。随着对话增长，单次保存的序列化成本是 O(N)；而最近我们又新增了每个 loop iteration 结束后都保存一次的需求，导致一个 turn 内多次保存，总成本变成 O(N×M) 的二次膨胀。

同时 bridge 层在 streaming 期间对每个 chunk 都执行 `load + mutate last assistant msg + save`，进一步放大了全量重写的开销。

## 目标

1. 让 core 层"每个 loop iteration 结束后保存"的成本降到 **O(delta)**，只序列化新增消息。
2. 去掉 bridge 层 streaming chunk 级别的 load/save，统一由 core 层按 loop iteration 粒度持久化。
3. 保持 `SessionProvider` 接口不变，兼容已有调用方。

## 非目标

- 不兼容旧的 `{sessionId}.json` 格式。
- 不改存储引擎为数据库（SQLite 等后续若需要可单独设计）。
- 不处理 message 删除/编辑，conversation 仍是 append-only。

## Step 粒度定义

本设计中的"step"指 `loop-strategy.ts` 里的一次 `ReactLoop.iterate()` 调用，即一次 LLM 推理（含其内部同步执行的 tool-call/tool-result）。`turn.ts` 的 `while` 循环每完成一次 iterate，就触发一次保存。

## 存储格式

每个 session 对应三个文件（LocalSessionProvider）或两个文件（FileSessionProvider）：

| 文件 | 内容 | 说明 |
|---|---|---|
| `{sessionId}.jsonl` | 消息日志，每行一个 `ModelMessage` JSON | 增量追加 |
| `{sessionId}.meta.json` | session 元数据 | 每次 save 全量重写，体积极小 |
| `{sessionId}.msg.json` | LocalSessionProvider 的 `msgCache` | 可选，仅 local 需要 |

### `{sessionId}.jsonl` 示例

```jsonl
{"id":"m1","role":"user","content":[{"type":"text","text":"hello"}]}
{"id":"m2","role":"assistant","content":[{"type":"text","text":"Hi"}]}
{"id":"m3","role":"tool","content":[{"type":"tool-result","toolCallId":"c1","toolName":"read","output":"..."}]}
```

### `{sessionId}.meta.json` 示例

```json
{
  "sessionId": "...",
  "currentTurn": 3,
  "metadata": { "title": "test" },
  "createdAt": "2026-07-06T...",
  "updatedAt": "2026-07-06T..."
}
```

## 增量追加算法

Provider 内部维护 `Map<sessionId, number> persistedMessageCount`，表示该 session 已有多少条消息被写入 `.jsonl`。

```
save(session):
  ensureDir()
  count = persistedMessageCount.get(session.sessionId) ?? 0
  newMessages = session.conversation.slice(count)
  if newMessages not empty:
    appendFile(jsonlPath, newMessages.map(JSON.stringify).join('\n') + '\n')
    persistedMessageCount.set(session.sessionId, session.conversation.length)
  writeMeta(session)  // 全量写，O(1)
```

由于 bridge 层不再在 streaming 期间修改已持久化的 assistant message，conversation 对 provider 是 append-only，不会出现同一条 message 内容变化后需要重写 jsonl 的情况。

### 原子性

- `.jsonl` 追加使用 `appendFile`，在同一 provider 实例对同一 session 的 save 是串行调用（core 的 `onStepFinish` 和 bridge 都不并发写同一会话），因此追加不会交错。
- `.meta.json` 使用"临时文件 + rename"原子写入，避免元数据文件损坏。

## 加载

`load(sessionId)` 逻辑：

1. 若 `.jsonl` 存在，逐行读取并 parse 为 `ModelMessage[]`。
2. 读取 `.meta.json` 获取 `currentTurn`、`metadata`、`createdAt`、`updatedAt`。
3. 更新 `persistedMessageCount` 为 conversation 长度。
4. 若 `.jsonl` 不存在，返回 null（不兼容旧 `.json` 格式）。

## 对 bridge 层的调整

`packages/bridge/src/agent.ts` 中 streaming chunk 的持久化逻辑需要删除：

```typescript
// 删除以下逻辑
if (chunk.type === 'text-delta' || ... ) {
  try {
    accumulatedParts = reduceStreamChunk(...);
    const session = await sessionProvider.load(sessionId);
    if (session) {
      const lastMsg = session.conversation[...];
      lastMsg.content = accumulatedParts;
      await sessionProvider.save(session);
    }
  } catch { }
}
```

`accumulatedParts` 仍保留用于 UI 渲染（如果需要），但不再用于持久化。core 层在每个 loop iteration 结束时会自然地把定型后的 assistant message 写入 `.jsonl`。

## 模块拆分

按 `module-separation-convention` 拆分：

```
packages/core/src/plugins/session/
├── base.ts                 # 变薄，委托 JsonlSessionStore
├── jsonl-store.ts          # 新增：JSONL 读写、迁移、增量算法
├── file/index.ts           # 修改 list() 读取 .meta.json
├── local/index.ts          # 修改 write 处理 msgCache -> .msg.json
└── in-memory/index.ts      # 不变
```

`jsonl-store.ts` 职责单一：底层文件 IO 和 diff/append 逻辑。
`base.ts` 职责：实现 `SessionProvider` 接口并协调 store。

## 错误处理

| 场景 | 处理 |
|---|---|
| `.jsonl` 某行损坏 | `load()` 整体返回 null |
| `.meta.json` 损坏但 `.jsonl` 可读 | 用 `.jsonl` 消息 + 默认元数据（`currentTurn: 0`、`metadata: {}`、`createdAt`/`updatedAt` 为文件mtime）重建 session |
| save 时磁盘满 | 抛出错误，由 core 的 catch 捕获并标记 session 状态为 error |

## 原子写细节

`.meta.json` 使用临时文件 + rename：

1. 写入 `{sessionId}.meta.json.tmp`
2. `rename` 覆盖 `{sessionId}.meta.json`

这样即使写入过程中进程崩溃，也不会留下半成品的 meta 文件。

## 测试策略

1. **增量追加测试**：多次 save，验证 `.jsonl` 行数递增，最终 load 结果正确。
2. **元数据更新测试**：修改 title 后 save，验证 `.meta.json` 更新且 `.jsonl` 不重复追加。
3. **并发安全测试**：对同一 session 快速连续 save，验证文件不损坏。
4. **bridge 测试**：验证 streaming chunk 不再触发 sessionProvider.save。

## 回滚方案

若新格式出现严重问题，可通过 git revert 回到全量 JSON 方案。由于不兼容旧 `.json`，回滚后之前用新格式创建的 session 将无法读取，属于破坏性变更。本设计适用于全新部署或允许丢弃旧 session 的场景。
## 影响范围

- `packages/core/src/plugins/session/*`
- `packages/core/tests/local-session-provider.test.ts`
- `packages/core/tests/file-session-provider.test.ts`
- `packages/bridge/src/agent.ts`
- `packages/bridge/tests/*`（如有 streaming persistence 相关测试）

---
