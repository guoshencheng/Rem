# Compact Dark Workbench Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Rem Web 完整对齐 Compact Dark Workbench 设计规范，同时保留现有 Session、消息、Thread、流式、中断和重连行为。

**Architecture:** 以 `index.css` 中的 `--ds-*` token 作为唯一视觉源，通过 shadcn 语义变量和基础组件变体向业务组件提供样式。新增 `WorkbenchShell` 管理桌面三栏与窄屏抽屉，Session、公开会话、协作检查器继续订阅现有 Zustand store，不修改 Core、HTTP/SSE 协议或消息状态模型。

**Tech Stack:** React 19、TypeScript、Vite、Tailwind CSS v4、shadcn/ui、Radix UI、Zustand、Vitest、Testing Library、agent-browser

---

## 执行前置

执行代码前必须先：

1. 使用 `web-debugging-with-agent-browser` skill，在真实浏览器中记录当前桌面与窄屏基线。
2. 使用 `compact-dark-workbench`、`module-separation-convention` 和 `shadcn` skill 指导实现。
3. 若需要隔离工作区，使用 `using-git-worktrees` 创建 worktree；不要在脏工作树上覆盖用户改动。
4. shadcn 组件文档必须通过 `pnpm dlx shadcn@latest docs ...` 获取，新增组件先用 `--dry-run` 检查。

## 文件职责映射

**新增文件：**

- `packages/web/src/client/components/workbench-shell.tsx`：桌面三栏、单 Agent 双栏和受控窄屏抽屉布局。
- `packages/web/src/client/hooks/use-media-query.ts`：集中管理 `matchMedia` 订阅。
- `packages/web/src/client/components/section-label.tsx`：三个以上区域共用的 8px 上下文标签。
- `packages/web/src/client/components/status-dot.tsx`：running/success/error/offline 状态点。
- `packages/web/src/client/components/collaboration-inspector.tsx`：Thread 选择、Agent 身份、私有消息和工具状态的右栏组合。
- `packages/web/src/client/components/thread-message.tsx`：单条 Thread 私有消息渲染。
- `packages/web/src/client/components/ui/sheet.tsx`：shadcn Sheet，用于窄屏侧栏。
- `packages/web/src/client/components/ui/alert.tsx`：shadcn Alert，用于错误上下文。
- `packages/web/src/client/components/ui/empty.tsx`：shadcn Empty，用于统一空态。
- `packages/web/tests/design-tokens.test.ts`：源 token 与语义映射契约。
- `packages/web/tests/workbench-shell.test.tsx`：桌面/窄屏布局与抽屉行为。
- `packages/web/tests/session-list.test.tsx`：Session 行、状态和空态。
- `packages/web/tests/collaboration-inspector.test.tsx`：Thread 选择和私有消息。
- `packages/web/tests/status-bar.test.tsx`：SSE 状态表达。

**修改文件：**

- `packages/web/src/client/index.css`：完整 `--ds-*` token、shadcn 别名和 Tailwind v4 映射。
- `packages/web/src/client/components/ui/button.tsx`：27px/25px Compact Workbench 尺寸变体。
- `packages/web/src/client/components/ui/badge.tsx`：16px Badge 与 14px Tag 变体。
- `packages/web/src/client/components/ui/card.tsx`：8px 紧凑卡片间距。
- `packages/web/src/client/components/ui/tabs.tsx`：25px Thread 选择器。
- `packages/web/src/client/components/ui/textarea.tsx`：输入框语义边框和紧凑正文。
- `packages/web/src/client/app.tsx`：组合 WorkbenchShell 并持有响应式面板/Thread 选择 UI 状态。
- `packages/web/src/client/components/top-bar.tsx`：48px 顶栏与窄屏面板入口。
- `packages/web/src/client/components/status-bar.tsx`：26px 状态栏和 SSE 状态。
- `packages/web/src/client/components/session-list.tsx`：205px 面板内的 34px Session 行。
- `packages/web/src/client/components/chat-view.tsx`：公开会话区域层级与错误空态。
- `packages/web/src/client/components/composer.tsx`：紧凑输入卡片。
- `packages/web/src/client/components/message-item.tsx`：公开 Agent/用户消息样式。
- `packages/web/src/client/components/tool-call-block.tsx`：工具状态语义化与长内容约束。
- `packages/web/src/client/components/reasoning-block.tsx`：统一卡片/标题 token。
- `packages/web/src/client/components/new-session-dialog.tsx`：错误 Alert 与控件密度。
- `packages/web/src/client/api/bus.ts`：发布 connecting/connected/reconnecting 状态事件。
- `packages/web/tests/chat-view.test.tsx`：公开会话空态、错误和流式消息。
- `packages/web/tests/bus.test.ts`：连接状态事件。
- `packages/web/tests/thread-panel.test.tsx`：迁移到 collaboration inspector 测试后删除。

**删除文件：**

- `packages/web/src/client/components/thread-panel.tsx`：职责迁移到 `collaboration-inspector.tsx` 与 `thread-message.tsx`。
- `packages/web/tests/thread-panel.test.tsx`：由更明确的 inspector 测试替代。

---

### Task 1: 建立源 token 与基础组件密度

**Files:**
- Create: `packages/web/tests/design-tokens.test.ts`
- Modify: `packages/web/src/client/index.css`
- Modify: `packages/web/src/client/components/ui/button.tsx`
- Modify: `packages/web/src/client/components/ui/badge.tsx`
- Modify: `packages/web/src/client/components/ui/card.tsx`
- Modify: `packages/web/src/client/components/ui/tabs.tsx`
- Modify: `packages/web/src/client/components/ui/textarea.tsx`

- [ ] **Step 1: 写 token 契约失败测试**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/client/index.css', import.meta.url), 'utf8');

describe('Compact Dark Workbench tokens', () => {
  it.each([
    ['--ds-bg', '#08090c'],
    ['--ds-panel', '#12141a'],
    ['--ds-primary', '#6752da'],
    ['--ds-selected-bg', '#28233d'],
    ['--ds-topbar-height', '48px'],
    ['--ds-statusbar-height', '26px'],
    ['--ds-left-panel-width', '205px'],
    ['--ds-right-panel-width', '268px'],
  ])('定义 %s', (token, value) => {
    expect(css).toContain(`${token}: ${value}`);
  });

  it('让 shadcn primary 引用源 token', () => {
    expect(css).toContain('--primary: var(--ds-primary)');
    expect(css).toContain('--accent: var(--ds-selected-bg)');
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter rem-agent-web test -- design-tokens.test.ts`

Expected: FAIL，缺少 `--ds-*` token。

- [ ] **Step 3: 在 index.css 中引入完整源 token 与 Tailwind v4 映射**

将 skill 的 `tokens.css` 原值合并进 `:root`，保留全部颜色、字体、间距、尺寸与圆角 token；增加以下 Rem 状态 token，并让 `.dark` 语义变量引用源 token：

```css
:root {
  color-scheme: dark;
  --ds-bg: #08090c;
  --ds-surface: #0e1015;
  --ds-panel: #12141a;
  --ds-raised: #181a20;
  --ds-hover: #191b22;
  --ds-border: #292b32;
  --ds-border-strong: #383b44;
  --ds-text: #eeeeee;
  --ds-text-body: #d6d7dc;
  --ds-text-muted: #8d909a;
  --ds-text-subtle: #747781;
  --ds-text-faint: #696c75;
  --ds-primary: #6752da;
  --ds-primary-border: #7059ed;
  --ds-primary-foreground: #ffffff;
  --ds-selected-bg: #28233d;
  --ds-selected-border: #5e4bc2;
  --ds-composite-bg: #6d58e622;
  --ds-composite-text: #b4a9ff;
  --ds-status-running: #8f7cff;
  --ds-status-success: #71b89a;
  --ds-status-error: #d07474;
  --ds-status-offline: #696c75;
  --ds-font-body: 12px;
  --ds-font-nav: 11px;
  --ds-font-control: 10px;
  --ds-font-meta: 9px;
  --ds-font-label: 8px;
  --ds-control-md-height: 27px;
  --ds-control-sm-height: 25px;
  --ds-badge-height: 16px;
  --ds-tag-height: 14px;
  --ds-topbar-height: 48px;
  --ds-statusbar-height: 26px;
  --ds-left-panel-width: 205px;
  --ds-right-panel-width: 268px;
  --ds-stage-min-width: 460px;
}

.dark {
  --background: var(--ds-bg);
  --foreground: var(--ds-text);
  --card: var(--ds-panel);
  --card-foreground: var(--ds-text);
  --primary: var(--ds-primary);
  --primary-foreground: var(--ds-primary-foreground);
  --secondary: var(--ds-raised);
  --secondary-foreground: var(--ds-text-body);
  --muted: var(--ds-raised);
  --muted-foreground: var(--ds-text-muted);
  --accent: var(--ds-selected-bg);
  --accent-foreground: var(--ds-composite-text);
  --border: var(--ds-border);
  --input: var(--ds-border-strong);
  --ring: var(--ds-primary-border);
}
```

同时在 `@theme inline` 暴露 `--color-status-*`、`--text-*` 和工作台尺寸映射，确保业务组件只使用语义类。

- [ ] **Step 4: 调整基础组件变体**

在 Button 中把默认和小尺寸映射为：

```ts
size: {
  default: 'h-[var(--ds-control-md-height)] px-[var(--ds-control-md-padding-x)] text-[length:var(--ds-font-control)]',
  sm: 'h-[var(--ds-control-sm-height)] px-[var(--ds-control-sm-padding-x)] text-[length:var(--ds-font-meta)]',
  icon: 'size-[var(--ds-control-md-height)]',
  'icon-sm': 'size-[var(--ds-control-sm-height)]',
}
```

在 Badge 新增 `size: 'badge' | 'tag'` 变体；Card 使用 `gap-[var(--ds-space-inner)]`、`p-[var(--ds-space-card)]`；Tabs 触发器使用 25px 高；Textarea 使用 body 字号与 `--ds-border-strong`。

- [ ] **Step 5: 运行契约测试和类型检查**

Run: `pnpm --filter rem-agent-web test -- design-tokens.test.ts && pnpm --filter rem-agent-web typecheck`

Expected: PASS，无 TypeScript 错误。

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/client/index.css packages/web/src/client/components/ui packages/web/tests/design-tokens.test.ts
git commit -m "feat(web): align design tokens and component density"
```

---

### Task 2: 添加共享语义组件与 shadcn 支撑组件

**Files:**
- Create: `packages/web/src/client/components/ui/sheet.tsx`
- Create: `packages/web/src/client/components/ui/alert.tsx`
- Create: `packages/web/src/client/components/ui/empty.tsx`
- Create: `packages/web/src/client/components/section-label.tsx`
- Create: `packages/web/src/client/components/status-dot.tsx`

- [ ] **Step 1: 获取正确组件 API 并预览变更**

Run:

```bash
cd packages/web
pnpm dlx shadcn@latest docs sheet alert empty
pnpm dlx shadcn@latest add sheet alert empty --dry-run
```

Expected: 输出 Radix 版本组件文档，预览仅新增目标 UI 文件和已有依赖可满足的包。

- [ ] **Step 2: 添加组件并检查生成文件**

Run: `cd packages/web && pnpm dlx shadcn@latest add sheet alert empty`

Expected: 新增三个 `src/client/components/ui/*.tsx` 文件，不覆盖其他业务组件。

- [ ] **Step 3: 新建共享语义组件**

```tsx
// section-label.tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function SectionLabel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-label font-extrabold uppercase leading-control tracking-[0.12em] text-muted-foreground', className)} {...props} />;
}
```

```tsx
// status-dot.tsx
import { cn } from '@/lib/utils';

export type StatusTone = 'running' | 'success' | 'error' | 'offline';

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', {
    'bg-status-running': tone === 'running',
    'bg-status-success': tone === 'success',
    'bg-status-error': tone === 'error',
    'bg-status-offline': tone === 'offline',
  }, className)} />;
}
```

- [ ] **Step 4: 构建验证并提交**

Run: `pnpm --filter rem-agent-web typecheck && pnpm --filter rem-agent-web build`

Expected: PASS。

```bash
git add packages/web/src/client/components/ui packages/web/src/client/components/section-label.tsx packages/web/src/client/components/status-dot.tsx packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add workbench semantic components"
```

---

### Task 3: 实现响应式 WorkbenchShell

**Files:**
- Create: `packages/web/src/client/hooks/use-media-query.ts`
- Create: `packages/web/src/client/components/workbench-shell.tsx`
- Create: `packages/web/tests/workbench-shell.test.tsx`

- [ ] **Step 1: 写桌面与窄屏失败测试**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkbenchShell } from '@/components/workbench-shell';

vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: vi.fn() }));

it('桌面渲染三栏，窄屏按受控状态显示 Session 抽屉', async () => {
  const { useMediaQuery } = await import('@/hooks/use-media-query');
  vi.mocked(useMediaQuery).mockReturnValue(true);
  render(<WorkbenchShell topBar={<div>top</div>} sessionPanel={<div>sessions</div>} inspector={<div>threads</div>} statusBar={<div>status</div>}><div>chat</div></WorkbenchShell>);
  expect(screen.getByText('sessions')).toBeTruthy();
  expect(screen.getByText('threads')).toBeTruthy();

  vi.mocked(useMediaQuery).mockReturnValue(false);
  const compact = render(<WorkbenchShell topBar={<div>top</div>} sessionPanel={<div>mobile sessions</div>} inspector={<div>mobile threads</div>} statusBar={<div>status</div>} sessionOpen onSessionOpenChange={vi.fn()} inspectorOpen={false} onInspectorOpenChange={vi.fn()}><div>chat</div></WorkbenchShell>);
  expect(compact.getByText('mobile sessions')).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter rem-agent-web test -- workbench-shell.test.tsx`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 matchMedia hook**

```ts
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
```

- [ ] **Step 4: 实现 WorkbenchShell**

定义 `WorkbenchShellProps`：`topBar`、`sessionPanel`、`inspector?`、`statusBar`、`children`、`sessionOpen`、`onSessionOpenChange`、`inspectorOpen`、`onInspectorOpenChange`。桌面使用 `grid-cols-[var(--ds-left-panel-width)_minmax(var(--ds-stage-min-width),1fr)_var(--ds-right-panel-width)]`；无 inspector 时使用两栏。窄屏只渲染中心区，并按受控 open 状态渲染两个 Sheet；触发按钮由 TopBar 提供，Sheet 必须包含 `SheetTitle`。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm --filter rem-agent-web test -- workbench-shell.test.tsx && pnpm --filter rem-agent-web typecheck`

Expected: PASS。

```bash
git add packages/web/src/client/hooks/use-media-query.ts packages/web/src/client/components/workbench-shell.tsx packages/web/tests/workbench-shell.test.tsx
git commit -m "feat(web): add responsive workbench shell"
```

---

### Task 4: 接入顶栏、App 与状态栏连接状态

**Files:**
- Modify: `packages/web/src/client/app.tsx`
- Modify: `packages/web/src/client/components/top-bar.tsx`
- Modify: `packages/web/src/client/components/status-bar.tsx`
- Modify: `packages/web/src/client/api/bus.ts`
- Modify: `packages/web/tests/bus.test.ts`
- Create: `packages/web/tests/status-bar.test.tsx`

- [ ] **Step 1: 为 SSE 状态事件写失败测试**

在 `bus.test.ts` mock fetch 流后监听 `rem:sse-state`，断言首次连接依次发布 `connecting`、`connected`；流断开后发布 `reconnecting`。

```ts
const states: string[] = [];
window.addEventListener('rem:sse-state', (event) => {
  states.push((event as CustomEvent<string>).detail);
});
startEventBus({ onEvent: vi.fn(), onReconnect: vi.fn() });
await vi.waitFor(() => expect(states).toContain('connected'));
expect(states[0]).toBe('connecting');
```

- [ ] **Step 2: 为状态栏写失败测试**

```tsx
render(<StatusBar session={session} threadCount={3} runningThreads={1} connection="connected" />);
expect(screen.getByText('Threads：3 · 1 运行中')).toBeTruthy();
expect(screen.getByText('SSE 已连接')).toBeTruthy();
```

- [ ] **Step 3: 运行并确认失败**

Run: `pnpm --filter rem-agent-web test -- bus.test.ts status-bar.test.tsx`

Expected: FAIL，当前 bus 无状态事件且 StatusBar 无 `connection` 属性。

- [ ] **Step 4: 实现连接状态发布**

在 `bus.ts` 新增：

```ts
export type SseConnectionState = 'connecting' | 'connected' | 'reconnecting';

function publishConnectionState(state: SseConnectionState): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rem:sse-state', { detail: state }));
  }
}
```

连接前发布 `connecting`，成功后发布 `connected`，catch 重试前发布 `reconnecting`。

- [ ] **Step 5: 重组 App、TopBar 与 StatusBar**

App 组合 `WorkbenchShell`，持有 `connection`、两个窄屏 Sheet 的 open 状态，以及按 sessionId 保存的 `selectedThreadId`。TopBar 使用 48px token，增加仅窄屏显示的 Sessions/Threads 图标按钮，并通过回调打开对应 Sheet。StatusBar 改为纯展示组件，使用 `StatusDot`，不再自行监听 window 事件。

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm --filter rem-agent-web test -- bus.test.ts status-bar.test.tsx && pnpm --filter rem-agent-web typecheck`

Expected: PASS。

```bash
git add packages/web/src/client/app.tsx packages/web/src/client/components/top-bar.tsx packages/web/src/client/components/status-bar.tsx packages/web/src/client/api/bus.ts packages/web/tests/bus.test.ts packages/web/tests/status-bar.test.tsx
git commit -m "feat(web): integrate workbench chrome and connection state"
```

---

### Task 5: 对齐 Session 导航

**Files:**
- Modify: `packages/web/src/client/components/session-list.tsx`
- Create: `packages/web/tests/session-list.test.tsx`

- [ ] **Step 1: 写 Session 行与空态失败测试**

```tsx
render(<SessionList sessions={[single, multi]} currentId="multi" onSelect={onSelect} />);
expect(screen.getByRole('button', { name: /多 Agent 会话/ })).toHaveAttribute('data-selected', 'true');
expect(screen.getByText('多 Agent')).toBeTruthy();
fireEvent.click(screen.getByRole('button', { name: /单 Agent 会话/ }));
expect(onSelect).toHaveBeenCalledWith('single');

const empty = render(<SessionList sessions={[]} onSelect={onSelect} />);
expect(empty.getByText('还没有 Session')).toBeTruthy();
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter rem-agent-web test -- session-list.test.tsx`

Expected: FAIL，当前行没有 `data-selected`，Tag 文案和空态结构不符合契约。

- [ ] **Step 3: 实现 34px Session 树行**

使用 `SectionLabel`、`ScrollArea`、`Badge size="tag"` 和 `Empty`。每行固定网格为 `22px 1fr auto`，主标题 10px、元信息 8px；当前项使用 `border-selected-border bg-selected-bg`，运行状态通过 `StatusDot` 表达。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm --filter rem-agent-web test -- session-list.test.tsx && pnpm --filter rem-agent-web typecheck`

Expected: PASS。

```bash
git add packages/web/src/client/components/session-list.tsx packages/web/tests/session-list.test.tsx
git commit -m "feat(web): align compact session navigation"
```

---

### Task 6: 对齐公开会话与输入区

**Files:**
- Modify: `packages/web/src/client/components/chat-view.tsx`
- Modify: `packages/web/src/client/components/composer.tsx`
- Modify: `packages/web/src/client/components/message-item.tsx`
- Modify: `packages/web/src/client/components/new-session-dialog.tsx`
- Modify: `packages/web/tests/chat-view.test.tsx`

- [ ] **Step 1: 扩充 ChatView 失败测试**

新增三个用例：无消息显示统一 Empty；`session.error` 使用 Alert；流式文本仍出现光标且用户消息可见。

```tsx
render(<ChatView sessionId="empty" running={false} onSend={vi.fn()} />);
expect(screen.getByText('开始一段公开会话')).toBeTruthy();

useStreamStore.setState((state) => ({
  bySession: { ...state.bySession, s1: { ...state.bySession.s1, error: '运行失败' } },
}));
render(<ChatView sessionId="s1" running={false} onSend={vi.fn()} />);
expect(screen.getByRole('alert')).toHaveTextContent('运行失败');
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter rem-agent-web test -- chat-view.test.tsx`

Expected: FAIL，当前无 Empty，错误不是 Alert。

- [ ] **Step 3: 实现公开会话信息层级**

ChatView 顶部使用 `SectionLabel`；消息列表 `p-[var(--ds-space-stage-x)]`；Agent 消息保持正文形式并增加 author label；用户消息使用 selected token。Composer 改为带强边框的紧凑输入卡片，发送按钮使用 27px 默认尺寸。NewSessionDialog 错误改用 Alert。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm --filter rem-agent-web test -- chat-view.test.tsx && pnpm --filter rem-agent-web typecheck`

Expected: PASS。

```bash
git add packages/web/src/client/components/chat-view.tsx packages/web/src/client/components/composer.tsx packages/web/src/client/components/message-item.tsx packages/web/src/client/components/new-session-dialog.tsx packages/web/tests/chat-view.test.tsx
git commit -m "feat(web): align public chat presentation"
```

---

### Task 7: 构建协作检查器并语义化工具状态

**Files:**
- Create: `packages/web/src/client/components/collaboration-inspector.tsx`
- Create: `packages/web/src/client/components/thread-message.tsx`
- Modify: `packages/web/src/client/components/tool-call-block.tsx`
- Modify: `packages/web/src/client/components/reasoning-block.tsx`
- Modify: `packages/web/src/client/app.tsx`
- Create: `packages/web/tests/collaboration-inspector.test.tsx`
- Delete: `packages/web/src/client/components/thread-panel.tsx`
- Delete: `packages/web/tests/thread-panel.test.tsx`

- [ ] **Step 1: 写受控 Thread 选择失败测试**

```tsx
render(<CollaborationInspector sessionId="s1" selectedThreadId="th1" onSelectedThreadChange={onChange} />);
expect(screen.getByText('拆解任务')).toBeTruthy();
fireEvent.click(screen.getByRole('tab', { name: /researcher/ }));
expect(onChange).toHaveBeenCalledWith('th2');
expect(screen.getByText('primary · th1')).toBeTruthy();
```

另写工具状态用例，断言 executing/success/error 对应可访问文本和 `data-tone`。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter rem-agent-web test -- collaboration-inspector.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 提取 ThreadMessage**

把现有 user/assistant 分支移动到 `thread-message.tsx`；assistant 内容继续复用 MarkdownContent、ReasoningBlock 和 ToolCallBlock，不改变 `Message`/`ContentBlock` 类型。

- [ ] **Step 4: 实现 CollaborationInspector**

组件接受：

```ts
interface CollaborationInspectorProps {
  sessionId: string;
  selectedThreadId?: string;
  onSelectedThreadChange: (threadId: string) => void;
}
```

使用 `SectionLabel`、Tabs、13px Agent identity、9px metadata、Card 和 ScrollArea。默认 active 为受控 ID 对应项，否则为第一个 Thread；当 Thread 列表变化且当前 ID 无效时，通过 effect 通知父组件选择第一个 ID。

- [ ] **Step 5: 语义化 ToolCallBlock**

删除 `text-emerald-*` 和图标 `size={...}`。状态由 `StatusDot` 与 `data-tone="running|success|error"` 表达；展开区限制宽度，参数/结果使用 `max-h-32 overflow-auto whitespace-pre-wrap break-words`。

- [ ] **Step 6: App 接入并删除旧组件**

App 按 sessionId 维护 `selectedThreadId`，把 CollaborationInspector 作为 WorkbenchShell 的 inspector；删除旧 ThreadPanel 与测试。

- [ ] **Step 7: 运行测试并提交**

Run: `pnpm --filter rem-agent-web test -- collaboration-inspector.test.tsx chat-view.test.tsx && pnpm --filter rem-agent-web typecheck`

Expected: PASS。

```bash
git add packages/web/src/client/components packages/web/src/client/app.tsx packages/web/tests/collaboration-inspector.test.tsx packages/web/tests/thread-panel.test.tsx
git commit -m "feat(web): add multi-agent collaboration inspector"
```

---

### Task 8: 全量自动化验证与结构清理

**Files:**
- Modify: only files required by failures found in this task

- [ ] **Step 1: 扫描视觉硬编码与非规范字号**

Run:

```bash
rg -n "#[0-9a-fA-F]{3,8}|emerald-|text-\[(?!8px|9px|10px|11px|12px|13px|17px)" packages/web/src/client --glob '*.tsx' --pcre2
```

Expected: 业务 TSX 中无十六进制颜色、`emerald-*` 或规范之外的任意字号；允许 CSS token 文件包含十六进制值。

- [ ] **Step 2: 检查文件大小**

Run: `wc -l packages/web/src/client/components/*.tsx packages/web/src/client/hooks/*.ts`

Expected: 实现文件不超过 200 行；超过 150 行时确认职责仍单一，否则按当前职责拆分。

- [ ] **Step 3: 运行 Web 测试**

Run: `pnpm --filter rem-agent-web test`

Expected: 全部 PASS。

- [ ] **Step 4: 运行仓库级验证**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`

Expected: 全部退出码为 0，结构检查无新增违规。

- [ ] **Step 5: 提交自动化清理**

若本任务产生修复：

```bash
git add packages/web
git commit -m "test(web): verify compact workbench alignment"
```

若没有文件变化，不创建空提交。

---

### Task 9: 真实浏览器桌面与窄屏验收

**Files:**
- Modify: only files required by verified browser defects

- [ ] **Step 1: 启动真实应用**

Run: `pnpm --filter rem-agent-web dev`

Expected: server 和 Vite client 启动成功，终端显示实际端口。

- [ ] **Step 2: 用 agent-browser 验证桌面多 Agent 场景**

在至少 1440×900 视口验证：48px 顶栏、205px 左栏、268px 右栏、26px 状态栏；Session/Thread 选择；消息发送；流式内容；工具调用展开；中断；独立滚动区。

- [ ] **Step 3: 验证桌面单 Agent 场景**

确认协作检查器不渲染，中心会话填充剩余宽度，状态栏 Thread 信息不产生空占位。

- [ ] **Step 4: 验证 900px 以下场景**

在 820×900 与 390×844 视口验证：中心会话全宽；顶栏可打开左右 Sheet；Sheet 有标题、Escape 可关闭、焦点可恢复；选择 Thread 后关闭再打开仍保持选择。

- [ ] **Step 5: 验证边界内容**

使用长 Session 标题、长 Agent ID、长工具参数、长工具输出、错误状态和 SSE 重连状态，确认截断、换行与内部滚动不破坏布局。

- [ ] **Step 6: 修复浏览器发现的问题并复验**

每个问题先保留可重复步骤，添加最小自动化测试，再修改对应单一职责文件。重复桌面、单 Agent 和窄屏场景，直到无布局或交互缺陷。

- [ ] **Step 7: 最终验证和提交**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure`

Expected: 全部 PASS。

若浏览器验收产生修复：

```bash
git add packages/web
git commit -m "fix(web): finish compact workbench browser verification"
```

若没有文件变化，不创建空提交。

---

## 完成定义

- 设计文档的 8 条验收标准均能对应到 Task 1–9 的自动化或浏览器验证步骤。
- Web 业务组件无视觉硬编码颜色和规范外任意字号。
- 单 Agent、多 Agent、桌面和窄屏四种组合均完成真实浏览器验证。
- `pnpm build && pnpm typecheck && pnpm test && pnpm check:structure` 全绿。
- 所有实现文件满足模块分离规范，`archive/` 未修改。
