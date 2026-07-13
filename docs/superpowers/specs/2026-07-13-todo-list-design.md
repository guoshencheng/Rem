# Session 级 TodoList 工具设计

> 日期：2026-07-13
> 状态：设计待实现

---

## 1. 背景与目标

当前 `rem-agent-core` 没有为单个 Session 维护结构化任务列表的能力。LLM 在多步任务中只能通过自然语言描述进度，用户无法在界面中直观看到当前计划、进行中的任务和已完成任务。

本设计目标：

1. 为每个 Session 维护一份带状态、有优先级、有顺序的 TODO 列表。
2. 通过内置工具 `todowrite` 让 agent 主动声明和更新计划。
3. 持久化到独立 SQLite 表，随 Session 生命周期级联删除。
4. 在 web UI 输入框顶部渲染可折叠的 Tasks 面板，实时同步列表。

---

## 2. 范围

### 2.1 In Scope

- `rem-agent-core` 内新增 `TodoStore`、`TodoService` 与 `todos` 表。
- 新增内置工具 `todowrite`，整体替换当前 Session 的 TODO 列表。
- 新增 `todo-updated` 广播事件，供 UI 实时订阅。
- `rem-agent-bridge` 暴露 `getTodos` 方法及 `GET /api/sessions/[id]/todos` 端点。
- `rem-agent-web` 在聊天页输入框顶部新增 `TodoPanel` 组件。
- 单元测试与集成测试覆盖核心路径。

### 2.2 Out of Scope

- 不实现任务依赖图（DAG / `blockedBy`）。如需要，用 `content` 文本描述阻塞原因。
- 不做跨 Session 的 TODO 共享；每个 Session 独立一份。
- 不暴露增量 CRUD 操作；只支持整体替换。
- 不实现历史版本 / 快照。
- 子 agent 调用 `todowrite` 时只影响自己的子 Session，不会覆盖父 Session 的 TODO。
- tui 端暂不实现（当前 `packages/tui` 无源码）。

---

## 3. 决策摘要

| 问题 | 决策 |
|---|---|
| 工具名称 | `todowrite`（与参考文档对齐） |
| 操作语义 | 整体替换，每次调用覆盖整个 Session 的 TODO 列表 |
| 存储方式 | 独立 SQLite 表 `todos`，不混在 session metadata 中 |
| 顺序表达 | 数组下标 → `position` 字段；数组顺序即展示顺序 |
| 状态枚举 | `pending` / `in_progress` / `completed` / `cancelled` |
| 优先级枚举 | `high` / `medium` / `low` |
| 复合主键 | `(session_id, position)` |
| 事件 | 单个 `todo-updated` 事件，载荷为完整列表 |
| UI 位置 | 输入框顶部可折叠面板 |
| 权限 | 默认规则允许 `todowrite`，不触发审批 |

---

## 4. 数据模型

### 4.1 业务对象

```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}
```

顺序由数组下标决定，不存到 `TodoItem` 中。

### 4.2 SQLite 表

```sql
CREATE TABLE IF NOT EXISTS todos (
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, position),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_todos_session
  ON todos(session_id);
```

要点：

- 复合主键 `(session_id, position)` 同时保证唯一性和顺序。
- `ON DELETE CASCADE` 确保 Session 删除时 TODO 级联删除。
- `created_at` / `updated_at` 仅用于 DB 层面，不回传给 LLM。

### 4.3 Schema 迁移

`SqliteSchemaManager` 将 `CURRENT_SCHEMA_VERSION` 从 `1` 提升到 `2`：

```ts
if (currentVersion < 2) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (...);
    CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id);
  `);
  db.prepare('UPDATE schema_version SET version = ?').run(2);
}
```

已有数据库启动时自动建表；新建数据库则一次性创建 `sessions` / `messages` / `rules` / `todos`。

---

## 5. 整体架构

```
packages/core/src/
├── storage/
│   ├── types.ts              # StorageProvider 增加 todoStore
│   ├── schema.ts             # 迁移到 schema v2，新增 todos 表
│   └── sqlite/
│       └── todo-store.ts     # SqliteTodoStore
├── todo/
│   ├── types.ts              # TodoItem, TodoStatus, TodoPriority
│   ├── service.ts            # TodoService 接口 + DefaultTodoService
│   └── errors.ts             # TodoValidationError
├── plugins/tool/builtin/
│   └── todo-write.ts         # todowrite 工具定义与执行器
└── bus-events.ts             # 新增 todo-updated 事件

packages/bridge/src/
├── agent.ts                  # 增加 getTodos 方法
├── agent-service.interface.ts
├── agent-remote-service.ts   # 增加 getTodos
└── index.ts

packages/web/src/
├── app/api/sessions/[id]/todos/
│   └── route.ts              # GET 端点
├── lib/
│   └── use-todos.ts          # 订阅事件 + 初始 fetch
└── components/
    └── todo-panel.tsx        # 输入框顶部面板
```

---

## 6. 接口定义

### 6.1 `TodoStore`

```ts
export interface TodoStore {
  getBySession(sessionId: string): Promise<TodoItem[]>;
  replaceForSession(sessionId: string, todos: TodoItem[]): Promise<void>;
}
```

### 6.2 `TodoService`

```ts
export interface TodoService {
  get(sessionId: string): Promise<TodoItem[]>;
  update(sessionId: string, todos: TodoItem[]): Promise<void>;
}
```

`DefaultTodoService`：

- 校验每个 `todos[i]` 的 `status` / `priority` 是否在枚举内。
- `content` 去前后空白，不允许为空字符串。
- 校验列表中 `in_progress` 任务至多一个。
- 数组长度上限暂定 50（防止滥用）。
- 在事务中调用 `todoStore.replaceForSession`。
- 本身不发送事件；事件由调用方（如 `todowrite` 执行器）在拿到 workspace 后发布。

### 6.3 `StorageProvider` 扩展

```ts
export interface StorageProvider {
  init(): Promise<void>;
  close(): Promise<void>;
  readonly sessionStore: SessionStore;
  readonly ruleStore: RuleStorage;
  readonly todoStore: TodoStore;   // 新增
}
```

`SqliteStorageProvider` 在构造时初始化 `SqliteTodoStore` 并共享同一 DB 连接。

### 6.4 `AgentContext` 扩展

```ts
export interface AgentContext {
  // ... 现有字段
  todoService: TodoService;
}
```

### 6.5 `BusEvent` 扩展

```ts
export type BusEvent =
  | ... // 现有事件
  | {
      workspace: string;
      sessionId: string;
      type: 'todo-updated';
      todos: TodoItem[];
    };
```

---

## 7. Tool 层

### 7.1 Schema

```ts
import { Type, type Static } from '@sinclair/typebox';

const TodoStatusSchema = Type.Union(
  [
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
    Type.Literal('cancelled'),
  ],
  { description: 'Current status of the task' },
);

const TodoPrioritySchema = Type.Union(
  [
    Type.Literal('high'),
    Type.Literal('medium'),
    Type.Literal('low'),
  ],
  { description: 'Priority level of the task' },
);

const TodoItemSchema = Type.Object({
  content: Type.String({ description: 'Brief description of the task' }),
  status: TodoStatusSchema,
  priority: TodoPrioritySchema,
});

const TodoWriteSchema = Type.Object({
  todos: Type.Array(TodoItemSchema, { description: 'Full ordered list of todos for this session' }),
}, { additionalProperties: false });
```

### 7.2 工具描述

```
todowrite: Update the session's complete ordered todo list.

Use proactively when:
- The user asks for a multi-step task.
- You are starting work that has 3+ non-trivial steps.
- A new instruction arrives that changes the plan.
- You need to mark a task as completed, in_progress, or cancelled.

Skip when:
- The request is a single trivial step or a pure Q&A.

Status semantics:
- pending: waiting to be worked on.
- in_progress: the one task you are currently doing. Keep exactly one in_progress at a time.
- completed: only after verification, never based on intent.
- cancelled: no longer needed.

Priority semantics:
- high: do next / blocking.
- medium: normal priority.
- low: can be deferred.

The list is ordered: position 0 is the current/next task. Always send the full updated list.
```

### 7.3 执行器

```ts
export function createTodoWriteToolExecutor(
  todoService: TodoService,
  publish: (event: BusEvent) => void,
  workspace: string,
): ToolExecutor<typeof TodoWriteSchema> {
  return async (input, ctx) => {
    if (!ctx.sessionId) {
      throw new Error('todowrite requires a sessionId in tool context');
    }

    await todoService.update(ctx.sessionId, input.todos);

    publish({
      workspace,
      sessionId: ctx.sessionId,
      type: 'todo-updated',
      todos: input.todos,
    });

    return {
      output: JSON.stringify(input.todos, null, 2),
      details: { todos: input.todos },
    };
  };
}
```

### 7.4 注册位置

`runAgent` 内创建 `toolProviderWithDelegate` 后，再叠加 `todowrite`：

```ts
const todoWriteTool = createTodoWriteTool(
  ctx.todoService,
  (event) => params.agentState.publish(event),
  workspace,
);
toolProviderWithDelegate.register(todoWriteTool.definition, todoWriteTool.executor);
```

这样 `todowrite` 与其他内置工具一样走统一的 tool policy 和权限管道。

---

## 8. 权限

新增默认规则：

```ts
{ permission: 'todowrite', pattern: '*', action: 'allow', source: 'default' }
```

理由：

- `todowrite` 只修改当前 Session 自己的结构化状态，不涉及文件系统或外部系统。
- 不视为 dangerous tool，不需要用户逐次审批。
- 子 agent 使用独立的子 Session，调用 `todowrite` 时不会污染父 Session 的 TODO。

---

## 9. 数据流

### 9.1 初始化

```ts
const storageProvider = options?.storageProvider
  ?? new SqliteStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });
await storageProvider.init();

const todoService = new DefaultTodoService(storageProvider.todoStore);
```

`SqliteStorageProvider.init()` 在 schema manager 中从 v1 迁移到 v2，创建 `todos` 表。

### 9.2 更新 TODO 列表

```
LLM 调用 todowrite
  → OverlayToolProvider.execute
  → todoService.update(sessionId, todos)
  → DefaultTodoService 校验
  → SqliteTodoStore.replaceForSession (事务 delete + insert)
  → agentState.publish(todo-updated)
  → Bridge SSE stream 推送事件
  → Web UI 刷新 TodoPanel
```

### 9.3 UI 加载

```
用户打开会话
  → Web GET /api/sessions/[id]/todos
  → AgentService.getTodos(workspace, sessionId)
  → todoService.get(sessionId)
  → 渲染初始列表
  → 同时订阅 useAgentBus 的 todo-updated 事件
```

---

## 10. UI 设计

### 10.1 位置

输入框顶部固定一个可折叠面板。

### 10.2 展开状态

- 标题行左侧显示 `Tasks`，右侧显示未完成任务数。
- 列表按 `position` 顺序展示。
- 每项显示：
  - 序号
  - 任务内容
  - 状态 badge（pending / in_progress / completed / cancelled）
  - 优先级 badge（high / medium / low）
- `in_progress` 任务用高亮图标（▶）标识。
- 已完成的任务置灰并加删除线。

### 10.3 折叠状态

只显示标题行和未完成任务数，点击可展开。

### 10.4 实时更新

- 首次加载调用 `getTodos`。
- 后续通过 `useAgentBus` 监听 `todo-updated` 事件更新本地状态。

---

## 11. 错误处理

- `TodoValidationError`：状态/优先级非法、内容为空、数组超长时抛出，返回 tool 错误信息。
- `sessionId` 缺失：返回 tool 错误。
- SQLite 事务失败：由 `SqliteTodoStore` 包装为 `StorageError`，保持与现有存储层错误一致。
- 工具执行失败不影响主循环继续，只把 error 写入 tool-result。

---

## 12. 测试

### 12.1 单元测试

- `packages/core/tests/storage/sqlite-todo-store.test.ts`
  - `getBySession` 按 position 顺序返回。
  - `replaceForSession` 整体替换且级联旧数据。
  - Session 删除后 todos 被级联删除。
- `packages/core/tests/todo/todo-service.test.ts`
  - 校验非法状态/优先级。
  - 校验空内容/超长数组。
  - 更新成功后发布事件。
- `packages/core/tests/plugins/tool/todo-write.test.ts`
  - 正常整体替换。
  - 缺少 sessionId 报错。
  - 无效输入返回 tool 错误。

### 12.2 集成测试

- 构造一个 agent 运行，触发 LLM 调用 `todowrite`。
- 断言 `tool-result` 中包含完整列表。
- 断言广播事件中包含 `todo-updated`。
- 断言 DB 中按顺序写入。

### 12.3 验收命令

```bash
pnpm typecheck
pnpm test
```

---

## 13. 影响面

### 13.1 修改文件

- `packages/core/src/storage/types.ts`：增加 `todoStore`。
- `packages/core/src/storage/schema.ts`：schema v2 迁移。
- `packages/core/src/storage/index.ts`：导出新增类型。
- `packages/core/src/storage/sqlite/provider.ts`：初始化 `SqliteTodoStore`。
- `packages/core/src/storage/sqlite/todo-store.ts`：新增。
- `packages/core/src/todo/types.ts`、`service.ts`、`errors.ts`：新增。
- `packages/core/src/plugins/tool/builtin/todo-write.ts`：新增。
- `packages/core/src/agent-context.ts`：增加 `todoService`。
- `packages/core/src/agent-context-builder.ts`：创建 `DefaultTodoService`。
- `packages/core/src/run-agent.ts`：注册 `todowrite` 工具。
- `packages/core/src/bus-events.ts`：增加 `todo-updated`。
- `packages/core/src/security/rules/profiles.ts` 或 `agent-context-builder.ts`：默认允许 `todowrite`。
- `packages/bridge/src/agent.ts`、`agent-service.interface.ts`、`agent-remote-service.ts`：增加 `getTodos`。
- `packages/web/src/app/api/sessions/[id]/todos/route.ts`：新增。
- `packages/web/src/components/todo-panel.tsx`：新增。
- `packages/web/src/lib/use-todos.ts`：新增。

### 13.2 不修改文件

- 现有文件系统工具集不受影响。
- `Session` 结构不变，不混 `todos` 到 metadata。
- `AgentState` 基本不变，仅复用其 `publish` 能力。

---

## 14. 后续可扩展点

- 如需表达依赖关系，可新增 `blockedBy` 字段并升级为 DAG，但需先做 cycle detection。
- 如需导出，可将 TODO 列表渲染为 Markdown checklist。
- 如未来支持 tui，可复用同一 `TodoService` 和事件。
- 如需在 UI 上直接操作（手动勾选/删除），需要新增 bridge API，但不在本设计范围内。
