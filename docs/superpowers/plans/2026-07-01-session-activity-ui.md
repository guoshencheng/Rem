# Session Activity Status UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 sidebar 展示各会话实时运行状态，在 Chat 底部展示当前会话 Agent 细粒度活动状态，并重构 Chat 布局与多行输入框。

**Architecture:** 在 `rem-agent-bridge` 中新增 `SessionActivityTracker`，基于现有 `AgentStreamChunk` 推导 activity 并通过 bus 广播 `activity-change`；`SessionSummary` 扩展 `activity` 字段供列表接口直接返回。`rem-agent-web` 消费 bus 事件更新本地状态，并重构 `MessageItem`/`InputBox`/`ChatPanel`/`SessionItem` 的 UI。

**Tech Stack:** TypeScript, React 19, Next.js 15, Tailwind CSS, vitest, rem-agent-core, rem-agent-bridge

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/bridge/src/types.ts` | 扩展 `SessionActivity`、`SessionSummary`、`BusEvent` |
| `packages/bridge/src/session-activity-tracker.ts` | 根据 chunk 推导并维护 session activity，产生 `activity-change` 事件 |
| `packages/bridge/src/agent.ts` | 在 run 生命周期调用 tracker，并在 `listSessions` 中合并 activity |
| `packages/bridge/src/agent-session.ts` | 无变更（仅被 AgentService 调用） |
| `packages/bridge/src/index.ts` / `src/client.ts` | 导出新增类型 |
| `packages/bridge/tests/agent-service.test.ts` | 新增 tracker 与 activity 集成测试 |
| `packages/web/src/lib/use-agents.ts` | 消费 `activity-change`，维护本地 activity 与 pending tool calls |
| `packages/web/src/components/sidebar/session-item.tsx` | 根据 activity/status 显示状态圆点 |
| `packages/web/src/components/sidebar/session-list.tsx` | 透传 activity 到 SessionItem |
| `packages/web/src/components/chat/activity-bar.tsx` | 新增 Chat 底部状态条组件 |
| `packages/web/src/components/chat/chat-panel.tsx` | 引入 ActivityBar，调整外层布局容器 |
| `packages/web/src/components/chat/message-item.tsx` | 用户消息气泡 60%，Agent 消息无气泡拉通 |
| `packages/web/src/components/chat/input-box.tsx` | 改为上下结构多行 textarea |

---

### Task 1: 扩展 Bridge 类型

**Files:**
- Modify: `packages/bridge/src/types.ts`
- Modify: `packages/bridge/src/index.ts`
- Modify: `packages/bridge/src/client.ts`

- [ ] **Step 1: 在 `types.ts` 新增 `SessionActivity` 并扩展 `SessionSummary` 与 `BusEvent`**

```typescript
export type SessionActivity =
  | 'idle'
  | 'thinking'
  | 'calling-function'
  | 'outputting';

export interface SessionSummary {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: number;
  messageCount: number;
  activity?: SessionActivity;
}

export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity };
```

- [ ] **Step 2: 在 `index.ts` 导出 `SessionActivity`**

```typescript
export type {
  UIMessage,
  SessionSummary,
  SessionUpdate,
  BusEvent,
  SessionActivity,
} from './types.js';
```

- [ ] **Step 3: 在 `client.ts` 导出 `SessionActivity`**

```typescript
export type { SessionSummary, BusEvent, SessionActivity } from './types.js';
```

- [ ] **Step 4: 运行 bridge 类型检查**

```bash
pnpm --filter rem-agent-bridge typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/types.ts packages/bridge/src/index.ts packages/bridge/src/client.ts
git commit -m "feat(bridge): add SessionActivity type and BusEvent activity-change"
```

---

### Task 2: 实现 SessionActivityTracker

**Files:**
- Create: `packages/bridge/src/session-activity-tracker.ts`
- Create: `packages/bridge/tests/session-activity-tracker.test.ts`

- [ ] **Step 1: 创建 `SessionActivityTracker`**

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';
import type { SessionActivity } from './types.js';

export interface ActivityState {
  activity: SessionActivity;
  pendingToolCalls: Set<string>;
  updatedAt: number;
}

export type ActivityChangeListener = (sessionId: string, activity: SessionActivity) => void;

export class SessionActivityTracker {
  private state = new Map<string, ActivityState>();

  constructor(private onChange: ActivityChangeListener) {}

  start(sessionId: string): void {
    this.set(sessionId, 'thinking');
  }

  finish(sessionId: string): void {
    this.state.delete(sessionId);
    this.onChange(sessionId, 'idle');
  }

  get(sessionId: string): SessionActivity | undefined {
    return this.state.get(sessionId)?.activity;
  }

  applyChunk(sessionId: string, chunk: AgentStreamChunk): void {
    const current = this.state.get(sessionId);

    if (chunk.type === 'finish' || chunk.type === 'error') {
      this.finish(sessionId);
      return;
    }

    if (!current) {
      this.set(sessionId, 'thinking');
    }

    if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta') {
      this.set(sessionId, 'thinking');
      return;
    }

    if (chunk.type === 'tool-call-start' || chunk.type === 'tool-call') {
      const next = this.state.get(sessionId) ?? this.createState('calling-function');
      next.activity = 'calling-function';
      next.pendingToolCalls.add(chunk.toolCallId);
      this.state.set(sessionId, next);
      this.emit(sessionId);
      return;
    }

    if (chunk.type === 'tool-result-start' || chunk.type === 'tool-result' || chunk.type === 'tool-result-finish') {
      const next = this.state.get(sessionId);
      if (next) {
        next.pendingToolCalls.delete(chunk.toolCallId);
        this.state.set(sessionId, next);
        this.emit(sessionId);
      }
      return;
    }

    if (chunk.type === 'text-start' || chunk.type === 'text-delta') {
      this.set(sessionId, 'outputting');
    }
  }

  private createState(activity: SessionActivity): ActivityState {
    return { activity, pendingToolCalls: new Set(), updatedAt: Date.now() };
  }

  private set(sessionId: string, activity: SessionActivity): void {
    const existing = this.state.get(sessionId);
    if (existing) {
      if (existing.activity === activity) return;
      existing.activity = activity;
      existing.updatedAt = Date.now();
      this.state.set(sessionId, existing);
    } else {
      this.state.set(sessionId, this.createState(activity));
    }
    this.emit(sessionId);
  }

  private emit(sessionId: string): void {
    const activity = this.state.get(sessionId)?.activity ?? 'idle';
    this.onChange(sessionId, activity);
  }
}
```

- [ ] **Step 2: 编写 tracker 单元测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SessionActivityTracker } from '../src/session-activity-tracker.js';
import type { AgentStreamChunk } from 'rem-agent-core';

describe('SessionActivityTracker', () => {
  it('starts as thinking', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    expect(tracker.get('s1')).toBe('thinking');
    expect(listener).toHaveBeenCalledWith('s1', 'thinking');
  });

  it('transitions to outputting on text chunks', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    listener.mockClear();
    tracker.applyChunk('s1', { type: 'text-start', step: 1, partId: 'p1' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('outputting');
    expect(listener).toHaveBeenCalledWith('s1', 'outputting');
  });

  it('stays calling-function until tool result finishes', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    listener.mockClear();
    tracker.applyChunk('s1', { type: 'tool-call', step: 1, partId: 'p1', toolCallId: 'tc1', toolName: 'search', input: {} } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'text-start', step: 1, partId: 'p2' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'tool-result-finish', step: 1, partId: 'p1', toolCallId: 'tc1' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('calling-function');
    tracker.applyChunk('s1', { type: 'text-delta', step: 1, partId: 'p2', text: 'hi' } as AgentStreamChunk);
    expect(tracker.get('s1')).toBe('outputting');
  });

  it('clears to idle on finish', () => {
    const listener = vi.fn();
    const tracker = new SessionActivityTracker(listener);
    tracker.start('s1');
    tracker.applyChunk('s1', { type: 'finish', output: { content: 'hi', completed: true } } as AgentStreamChunk);
    expect(tracker.get('s1')).toBeUndefined();
    expect(listener).toHaveBeenLastCalledWith('s1', 'idle');
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-bridge test packages/bridge/tests/session-activity-tracker.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/bridge/src/session-activity-tracker.ts packages/bridge/tests/session-activity-tracker.test.ts
git commit -m "feat(bridge): add SessionActivityTracker"
```

---

### Task 3: 在 AgentService 中集成 Tracker

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Modify: `packages/bridge/tests/agent-service.test.ts`

- [ ] **Step 1: 在 `AgentService` 中初始化 tracker 并在 run 生命周期调用**

修改 `packages/bridge/src/agent.ts`：

```typescript
import { SessionActivityTracker } from './session-activity-tracker.js';

export class AgentService implements IAgentService {
  private sessionProvider: SessionProvider;
  private workspace: string;
  private sessionManager: AgentSessionManager;
  private activityTracker: SessionActivityTracker;

  constructor(private providerManager: ProviderManager, workspace = 'default') {
    this.sessionProvider = providerManager.require<SessionProvider>('session');
    this.workspace = workspace;
    this.sessionManager = new AgentSessionManager(this.sessionProvider);
    this.activityTracker = new SessionActivityTracker((sessionId, activity) => {
      bus.publish({
        workspace: this.workspace,
        sessionId,
        type: 'activity-change',
        activity,
      });
    });
  }
```

在 `run` 方法中：

```typescript
async run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>> {
  const abortController = new AbortController();
  if (!runRegistry.register(sessionId, abortController)) {
    throw new ServiceError('Session is already running', 409);
  }

  this.activityTracker.start(sessionId);
  bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });

  // ... existing coreRunAgent call ...
```

在 wrapped stream 的 chunk 循环中：

```typescript
for await (const chunk of result.stream.fullStream) {
  yield chunk;
  this.activityTracker.applyChunk(sessionId, chunk);
  // ... existing bus chunk publish ...

  if (chunk.type === 'finish') {
    bus.publish({ workspace, sessionId, type: 'session-end' });
  }
  if (chunk.type === 'error') {
    bus.publish({ workspace, sessionId, type: 'session-error', error: String(chunk.error) });
  }
}
```

在 `result.output.catch(...)` 中确保 finish 时清理：

```typescript
result.output.catch(() => {}).finally(() => {
  runRegistry.remove(sessionId);
  this.activityTracker.finish(sessionId);
});
```

- [ ] **Step 2: 在 `listSessions` 中合并 activity**

```typescript
async listSessions(): Promise<SessionSummary[]> {
  const list = await this.sessionManager.listSessions();
  return list.map((s) => ({
    ...s,
    activity: this.activityTracker.get(s.sessionId) ?? 'idle',
  }));
}
```

- [ ] **Step 3: 在 `agent-service.test.ts` 新增 activity 集成测试**

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';
import { bus } from '../src/broadcast-bus.js';

it('reflects activity in listSessions during run', async () => {
  const summary = await service.createSession();
  const events: any[] = [];
  const unsub = bus.subscribe((e) => events.push(e));

  const chunks: AgentStreamChunk[] = [
    { type: 'text-start', step: 1, partId: 'p1' },
    { type: 'text-delta', step: 1, partId: 'p1', text: 'hello' },
    { type: 'finish', output: { content: 'hello', completed: true } },
  ] as AgentStreamChunk[];

  // This test requires mocking coreRunAgent; since AgentService imports it
  // directly, add a vi.mock at the top of the test file:
  // vi.mock('rem-agent-core', async (importOriginal) => {
  //   const mod = await importOriginal<typeof import('rem-agent-core')>();
  //   return { ...mod, runAgent: vi.fn() };
  // });
  // Then set the mock before calling run.

  unsub();
});
```

由于 `AgentService` 直接 `import { runAgent as coreRunAgent } from 'rem-agent-core'`，需要在该测试文件顶部添加 `vi.mock`：

```typescript
import { vi } from 'vitest';
vi.mock('rem-agent-core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('rem-agent-core')>();
  return {
    ...mod,
    runAgent: vi.fn(),
  };
});
```

并在测试中控制 mock 返回：

```typescript
import { runAgent as coreRunAgent } from 'rem-agent-core';

// inside test
const mockedRunAgent = vi.mocked(coreRunAgent);
mockedRunAgent.mockReturnValue({
  stream: {
    fullStream: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
  },
  output: Promise.resolve({ content: 'hello', completed: true }),
} as any);

const stream = await service.run(summary.sessionId, 'hi');
for await (const _ of stream) { /* consume */ }

const list = await service.listSessions();
const found = list.find((s) => s.sessionId === summary.sessionId);
expect(found?.activity).toBe('idle');
```

- [ ] **Step 4: 运行 bridge 测试**

```bash
pnpm --filter rem-agent-bridge test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/agent.ts packages/bridge/tests/agent-service.test.ts
git commit -m "feat(bridge): integrate SessionActivityTracker into AgentService"
```

---

### Task 4: Web 状态消费

**Files:**
- Modify: `packages/web/src/lib/use-agents.ts`

- [ ] **Step 1: 扩展 `SessionState` 与 `SessionSummary` 类型**

```typescript
import type { SessionActivity } from 'rem-agent-bridge';

type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

interface SessionState {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingToolCalls: Set<string>;
}

export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
  pinned?: boolean;
  activity?: SessionActivity;
}
```

- [ ] **Step 2: 在 `ensureSession` 中初始化 `pendingToolCalls`**

```typescript
sessionMapRef.current.set(sessionId, {
  messages,
  status: 'idle',
  error: null,
  pendingToolCalls: new Set(),
});
```

- [ ] **Step 3: 在 bus 事件处理中新增 `activity-change` 分支并推导 chunk activity**

修改 switch 中的 `chunk` 分支，在更新消息后根据 chunk 推导 activity：

```typescript
case 'chunk': {
  if (!state) {
    await ensureSession(event.sessionId);
    state = map.get(event.sessionId);
    if (!state) return;
  }
  // ... existing message update ...

  // derive activity
  const chunk = event.chunk;
  if (chunk.type === 'finish' || chunk.type === 'error') {
    state.activity = 'idle';
    state.pendingToolCalls.clear();
  } else if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta') {
    state.activity = 'thinking';
  } else if (chunk.type === 'tool-call-start' || chunk.type === 'tool-call') {
    state.activity = 'calling-function';
    state.pendingToolCalls.add(chunk.toolCallId);
  } else if (chunk.type === 'tool-result-start' || chunk.type === 'tool-result' || chunk.type === 'tool-result-finish') {
    state.pendingToolCalls.delete(chunk.toolCallId);
    if (state.pendingToolCalls.size > 0) {
      state.activity = 'calling-function';
    }
    // When pendingToolCalls becomes empty, keep calling-function until the next non-tool chunk arrives
  } else if (chunk.type === 'text-start' || chunk.type === 'text-delta') {
    if (state.pendingToolCalls.size === 0) {
      state.activity = 'outputting';
    }
  }
  notifyChange();
  break;
}
```

新增 `activity-change` 分支：

```typescript
case 'activity-change': {
  if (!state) {
    await ensureSession(event.sessionId);
    state = map.get(event.sessionId);
    if (!state) return;
  }
  state.activity = event.activity;
  notifyChange();

  setSessionList((prev) =>
    prev.map((s) =>
      s.sessionId === event.sessionId ? { ...s, activity: event.activity } : s,
    ),
  );
  break;
}
```

- [ ] **Step 4: 初始化列表时同步 activity**

```typescript
useEffect(() => {
  agentService.listSessions().then((list) => {
    setSessionList(list as SessionSummary[]);
    // ... rest unchanged ...
  });
}, []);
```

- [ ] **Step 5: `currentSession` 暴露 activity**

```typescript
return {
  id: currentId,
  messages: state.messages,
  status: state.status,
  error: state.error,
  activity: state.activity,
};
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/use-agents.ts
git commit -m "feat(web): consume activity-change and derive activity from chunks"
```

---

### Task 5: Sidebar 状态圆点

**Files:**
- Modify: `packages/web/src/components/sidebar/session-item.tsx`
- Modify: `packages/web/src/components/sidebar/session-list.tsx`
- Modify: `packages/web/src/app/page.tsx`（如有必要透传 activity，但当前 sessions 已是 SessionSummary[]，无需变更）

- [ ] **Step 1: 在 `SessionItemProps` 中接收 activity**

```typescript
interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
  onSwitch(id: string): void;
  onDelete(id: string): void;
}
```

`SessionSummary` 已含 `activity`，无需额外 props。

- [ ] **Step 2: 添加状态圆点辅助函数与渲染**

在 `SessionItem` 中添加：

```typescript
function activityDot(activity?: SessionActivity) {
  switch (activity) {
    case 'thinking':
      return <span className="w-1.5 h-1.5 rounded-full bg-ac animate-pulse flex-shrink-0" />;
    case 'calling-function':
      return <span className="w-1.5 h-1.5 rounded-full bg-warn flex-shrink-0" />;
    case 'outputting':
      return <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />;
    default:
      return <span className="w-1.5 h-1.5 rounded-full bg-tx3/50 flex-shrink-0" />;
  }
}
```

在根 `div` 中标题前插入：

```tsx
{activityDot(session.activity)}
```

确保导入 `SessionActivity` 类型：

```typescript
import type { SessionActivity } from 'rem-agent-bridge';
```

注意：当前 `use-agents.ts` 也定义了本地 `SessionSummary`，为了避免冲突，确保 `SessionItem` 导入的是 `rem-agent-bridge` 的 `SessionSummary`，或统一使用本地类型。推荐在 `use-agents.ts` 中重新导出本地 `SessionSummary` 并包含 `activity`，`SessionItem` 从 `@/lib/use-agents` 导入。

- [ ] **Step 3: 运行 web 类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/sidebar/session-item.tsx
git commit -m "feat(web): show session activity dot in sidebar"
```

---

### Task 6: Chat 底部 ActivityBar

**Files:**
- Create: `packages/web/src/components/chat/activity-bar.tsx`
- Modify: `packages/web/src/components/chat/chat-panel.tsx`

- [ ] **Step 1: 创建 `ActivityBar` 组件**

```tsx
'use client';

import { Loader2, Wrench, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionActivity } from 'rem-agent-bridge';

interface ActivityBarProps {
  activity?: SessionActivity;
}

const config: Record<SessionActivity, { label: string; icon: React.ReactNode; color: string }> = {
  thinking: {
    label: 'Thinking...',
    icon: <Loader2 size={14} className="animate-spin" />,
    color: 'text-ac',
  },
  'calling-function': {
    label: 'Calling function...',
    icon: <Wrench size={14} />,
    color: 'text-warn',
  },
  outputting: {
    label: 'Outputting...',
    icon: <PenLine size={14} />,
    color: 'text-success',
  },
  idle: {
    label: '',
    icon: null,
    color: '',
  },
};

export function ActivityBar({ activity }: ActivityBarProps) {
  if (!activity || activity === 'idle') return null;
  const { label, icon, color } = config[activity];
  return (
    <div className={cn('flex items-center gap-2 px-1 py-2 text-xs', color)}>
      {icon}
      <span>{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: 在 `ChatPanel` 中引入并展示 `ActivityBar`**

修改 `ChatPanelProps`：

```typescript
interface ChatPanelProps {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  initialized: boolean;
  activity?: SessionActivity;
  onSend(content: string): void;
  onInterrupt(): void;
}
```

在 InputBox 上方、消息列表下方渲染：

```tsx
<div className="flex-1 flex flex-col min-w-0 min-h-0">
  <header>...</header>
  <div className="flex-1 min-h-0 overflow-hidden">
    <MessageList messages={messages} onSend={onSend} />
  </div>
  <div className="w-full max-w-3xl mx-auto px-4 pb-4">
    <ActivityBar activity={activity} />
    <InputBox ... />
  </div>
</div>
```

注意：`ChatPanel` 当前不直接导入 `MessageList`，它由 `ChatPanel` 内部渲染。需要把 `MessageList` 从 `chat-panel.tsx` 中导入（当前未导入，它通过 children？不，当前代码直接 `<MessageList messages={messages} onSend={onSend} />`，但文件里没有 import。请检查实际文件并补充 import）。

- [ ] **Step 3: 更新 `page.tsx` 传 activity**

```tsx
<ChatPanel
  key={currentSession.id}
  messages={currentSession.messages}
  status={currentSession.status}
  error={currentSession.error}
  activity={currentSession.activity}
  initialized={initialized}
  onSend={send}
  onInterrupt={interrupt}
/>
```

- [ ] **Step 4: 运行 web 类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/activity-bar.tsx packages/web/src/components/chat/chat-panel.tsx packages/web/src/app/page.tsx
git commit -m "feat(web): add ActivityBar in chat panel"
```

---

### Task 7: Chat 布局重构

**Files:**
- Modify: `packages/web/src/components/chat/message-item.tsx`
- Modify: `packages/web/src/components/chat/message-list.tsx`
- Modify: `packages/web/src/components/chat/chat-panel.tsx`

- [ ] **Step 1: 调整 `MessageItem` 布局**

用户消息区域：

```tsx
if (isUser) {
  return (
    <div className="flex justify-end py-3">
      <div className="max-w-[60%] rounded-card rounded-br-sm bg-ac text-ac-ink px-4 py-2.5 text-sm leading-relaxed">
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <ReactMarkdown key={i} ...>
                {part.text}
              </ReactMarkdown>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
```

Agent 消息区域：

```tsx
return (
  <div className="py-3">
    <div className={cn(
      'text-sm leading-relaxed text-tx',
      message.status === 'error' && 'text-err',
    )}>
      {message.parts.map((part, i) => {
        // ... existing part rendering ...
      })}
      {message.status === 'error' && message.error && (
        <div className="mt-2 px-3 py-2 rounded-btn bg-err-bg text-err text-xs border border-err/30">{message.error}</div>
      )}
    </div>
  </div>
);
```

移除 `thinking-bar` import（如果还存在）。

- [ ] **Step 2: 调整 `MessageList` 与 `ChatPanel` 外层容器**

`ChatPanel` 中内容区与输入区共用 `max-w-3xl mx-auto`：

```tsx
return (
  <div className="flex-1 flex flex-col min-w-0 min-h-0">
    <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
      <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
      {error && (
        <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">{error}</span>
      )}
    </header>
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4">
        <MessageList messages={messages} onSend={onSend} />
      </div>
    </div>
    <div className="max-w-3xl mx-auto w-full px-4 pb-4">
      <ActivityBar activity={activity} />
      <InputBox ... />
    </div>
  </div>
);
```

- [ ] **Step 3: 运行 web 类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/message-item.tsx packages/web/src/components/chat/message-list.tsx packages/web/src/components/chat/chat-panel.tsx
git commit -m "feat(web): refactor chat layout with shared max-width and bubble rules"
```

---

### Task 8: 多行输入框重构

**Files:**
- Modify: `packages/web/src/components/chat/input-box.tsx`

- [ ] **Step 1: 替换 input 为多行 textarea 并改为上下结构**

```tsx
'use client';

import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InputBoxProps {
  streaming: boolean;
  initialized: boolean;
  onSend(content: string): void;
  onInterrupt(): void;
}

export function InputBox({ streaming, initialized, onSend, onInterrupt }: InputBoxProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const text = content.trim();
    if (!text || !initialized) return;
    onSend(text);
    setContent('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [content, initialized, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) {
        handleSend();
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  return (
    <div className="bg-card border border-bd rounded-2xl p-3">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={!initialized || streaming}
        placeholder={initialized ? 'Message...' : 'Initializing...'}
        rows={1}
        className="w-full bg-transparent text-sm text-tx placeholder-tx3 outline-none resize-none min-h-[24px] max-h-[160px]"
      />
      <div className="flex items-center justify-between mt-2">
        <button
          type="button"
          disabled={!initialized}
          className="p-1.5 rounded-lg text-tx3 hover:bg-bd hover:text-tx disabled:opacity-50 transition-colors"
          aria-label="Add attachment"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        {streaming ? (
          <button
            type="button"
            onClick={onInterrupt}
            className="px-3 py-1.5 rounded-lg bg-err text-white text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!content.trim() || !initialized}
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
              content.trim()
                ? 'bg-ac text-ac-ink hover:opacity-90'
                : 'bg-tx3/20 text-tx3',
            )}
            aria-label="Send"
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行 web 类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/input-box.tsx
git commit -m "feat(web): redesign input box as multiline textarea with top-bottom layout"
```

---

### Task 9: 全仓类型检查与测试

- [ ] **Step 1: 全仓类型检查**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 2: 运行全仓测试**

```bash
pnpm test
```

Expected: PASS

- [ ] **Step 3: Commit（如仅有 lockfile 或无关变更则跳过）**

---

## Spec Coverage Check

| Spec Section | Implementing Task |
|---|---|
| Bridge 类型扩展 | Task 1 |
| 服务端 `SessionActivityTracker` | Task 2 |
| AgentService 集成 tracker | Task 3 |
| 前端消费 `activity-change` | Task 4 |
| Sidebar 状态圆点 | Task 5 |
| Chat 底部 ActivityBar | Task 6 |
| Chat 布局重构（max-width、气泡规则） | Task 7 |
| 多行输入框 | Task 8 |
| 测试 | Task 2, 3, 9 |
