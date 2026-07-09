# Composer 统一区块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ChatPanel` 底部的 Token 统计、Agent 状态、输入框整合为统一的 `ChatComposer` 区块组件。

**Architecture:** 新增 `ChatComposer` 组件作为单一容器，负责外层卡片和 Agent 状态栏；`InputBox` 负责内部 Approval、textarea 和底部工具栏（Token 统计 + 操作按钮）；`ChatPanel` 只负责布局大框架；现有子组件做最小调整以适应新的内部排布。

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Next.js 15, lucide-react, Vitest, @testing-library/react, jsdom

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `packages/web/src/components/chat/chat-composer.tsx` | 新建 | 统一输入区块容器：外层卡片 + Agent 状态栏 |
| `packages/web/src/components/chat/chat-composer.test.tsx` | 新建 | `ChatComposer` 的渲染与交互测试 |
| `packages/web/src/components/chat/chat-panel.tsx` | 修改 | 移除对 `TokenStatsBadge`、`ActivityBar`、`InputBox` 的直接引用，改用 `ChatComposer` |
| `packages/web/src/components/chat/activity-bar.tsx` | 修改 | 支持 `showIdle` prop，idle 时显示 "Idle" 占位 |
| `packages/web/src/components/chat/approval-bar.tsx` | 修改 | 移除根元素的 `mb-3`，由调用方控制间距 |
| `packages/web/src/components/chat/input-box.tsx` | 修改 | 移除外层 `bg-card` 圆角卡片容器；底部工具栏增加 Token 统计 |
| `packages/web/src/components/chat/token-stats.tsx` | 不修改 | 保持现有实现，由 `InputBox` 在底部工具栏内使用 |
| `vitest.config.ts` | 修改 | 添加 web 包测试环境支持（jsdom）和路径处理 |
| `packages/web/package.json` | 修改 | 添加 `@testing-library/react`、`@testing-library/jest-dom`、`jsdom` 依赖 |
| `packages/core/tests/setup.ts` | 修改 | 导入 `@testing-library/jest-dom` 的 expect 扩展 |

---

### Task 1: 配置 web 组件测试环境

**Files:**
- Modify: `packages/web/package.json`
- Modify: `vitest.config.ts`
- Modify: `packages/core/tests/setup.ts`

**Goal:** 让 Vitest 能运行 React 组件测试。

- [ ] **Step 1: 添加测试依赖到 web 包**

在 `packages/web/package.json` 的 `devDependencies` 中添加：

```json
{
  "@testing-library/jest-dom": "^6.4.0",
  "@testing-library/react": "^16.0.0",
  "@testing-library/user-event": "^14.5.0",
  "jsdom": "^24.0.0"
}
```

- [ ] **Step 2: 安装依赖**

Run:
```bash
pnpm install
```

Expected: 依赖安装成功，无报错。

- [ ] **Step 3: 修改 vitest 配置支持 web 测试**

修改 `vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    setupFiles: ['packages/core/tests/setup.ts'],
  },
  resolve: {
    alias: [
      { find: 'rem-agent-core/token-usage', replacement: resolve(__dirname, 'packages/core/src/token-usage.ts') },
      { find: 'rem-agent-core/llm/context-window', replacement: resolve(__dirname, 'packages/core/src/llm/context-window.ts') },
      { find: 'rem-agent-core', replacement: resolve(__dirname, 'packages/core/src/index.ts') },
      { find: 'rem-agent-bridge', replacement: resolve(__dirname, 'packages/bridge/src/index.ts') },
      { find: 'rem-agent-tui', replacement: resolve(__dirname, 'packages/tui/src/index.ts') },
      { find: '@/', replacement: resolve(__dirname, 'packages/web/src') },
    ],
  },
});
```

注意：这里添加 `@/` 别名是为了让测试能解析 web 包内部的 `@/lib/utils` 等导入。

- [ ] **Step 4: 在 setup 中扩展 jest-dom matchers**

修改 `packages/core/tests/setup.ts`：

```typescript
import '@testing-library/jest-dom';

// Test setup: paths are now managed via createDefaultAgentPaths({ agentDir, ... }) in individual tests.
// No global REM_AGENT_HOME override needed.
```

- [ ] **Step 5: 为 web 测试单独配置 environment**

由于全局 `environment: 'node'` 不适合 React 组件测试，在 `chat-composer.test.tsx` 和 `activity-bar.test.tsx` 文件顶部使用 Vitest 的 docblock 语法覆盖：

```typescript
/**
 * @vitest-environment jsdom
 */
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json vitest.config.ts packages/core/tests/setup.ts
pnpm install
# 确保 lockfile 已更新
git add pnpm-lock.yaml
git commit -m "chore: add web component test dependencies and aliases

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 调整 ActivityBar 支持 idle 占位

**Files:**
- Modify: `packages/web/src/components/chat/activity-bar.tsx`
- Test: `packages/web/src/components/chat/activity-bar.test.tsx`

**Goal:** 让 `ActivityBar` 在 `showIdle` 为 true 时显示 "Idle" 占位，避免卡片顶部高度跳动。

- [ ] **Step 1: 写失败测试**

创建 `packages/web/src/components/chat/activity-bar.test.tsx`：

```typescript
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityBar } from './activity-bar';

describe('ActivityBar', () => {
  it('returns null when idle and showIdle is false', () => {
    const { container } = render(<ActivityBar activity="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Idle placeholder when idle and showIdle is true', () => {
    render(<ActivityBar activity="idle" showIdle />);
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('renders thinking state regardless of showIdle', () => {
    render(<ActivityBar activity="thinking" />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
pnpm vitest run packages/web/src/components/chat/activity-bar.test.tsx
```

Expected: FAIL，提示 `showIdle` 类型不匹配或 "Idle" 未渲染。

- [ ] **Step 3: 实现 ActivityBar**

修改 `packages/web/src/components/chat/activity-bar.tsx`：

```tsx
'use client';

import { Loader2, Wrench, PenLine, Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionActivity } from 'rem-agent-bridge';

interface ActivityBarProps {
  activity?: SessionActivity;
  showIdle?: boolean;
}

const config: Record<Exclude<SessionActivity, 'idle'>, { label: string; icon: React.ReactNode; color: string }> = {
  pending: {
    label: 'Pending...',
    icon: <Hourglass size={14} />,
    color: 'text-tx3',
  },
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
};

export function ActivityBar({ activity, showIdle }: ActivityBarProps) {
  if (!activity || activity === 'idle') {
    if (!showIdle) return null;
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-xs text-tx3">
        <span className="inline-flex items-center justify-center w-3.5 h-3.5">●</span>
        <span>Idle</span>
      </div>
    );
  }

  const { label, icon, color } = config[activity];
  return (
    <div className={cn('flex items-center gap-2 px-1 py-2 text-xs', color)}>
      {icon}
      <span>{label}</span>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
pnpm vitest run packages/web/src/components/chat/activity-bar.test.tsx
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/activity-bar.tsx packages/web/src/components/chat/activity-bar.test.tsx
git commit -m "feat: support idle placeholder in ActivityBar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 调整 ApprovalBar 移除外边距

**Files:**
- Modify: `packages/web/src/components/chat/approval-bar.tsx`

**Goal:** 让 `ApprovalBar` 不再自带底部外边距，由 `InputBox` / `ChatComposer` 统一控制内部间距。

- [ ] **Step 1: 修改 ApprovalBar**

修改 `packages/web/src/components/chat/approval-bar.tsx` 第 40 行：

```tsx
// 旧
<div className="flex flex-col gap-2 mb-3">

// 新
<div className="flex flex-col gap-2">
```

- [ ] **Step 2: 运行类型检查**

Run:
```bash
pnpm --filter rem-agent-web typecheck
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/approval-bar.tsx
git commit -m "refactor: remove bottom margin from ApprovalBar root

Spacing is now controlled by the parent.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 调整 InputBox 为内部区块

**Files:**
- Modify: `packages/web/src/components/chat/input-box.tsx`

**Goal:** `InputBox` 不再渲染外层卡片容器；底部工具栏同时显示 Token 统计和操作按钮。

- [ ] **Step 1: 修改 InputBox props 和结构**

修改 `packages/web/src/components/chat/input-box.tsx`：

```tsx
'use client';

import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import type { ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import type { LanguageModelUsage } from 'rem-agent-core';
import { cn } from '@/lib/utils';
import { ApprovalBar } from './approval-bar';
import { TokenStatsBadge } from './token-stats';

interface InputBoxProps {
  streaming: boolean;
  initialized: boolean;
  pendingApprovals?: ApprovalRequest[];
  tokenUsage?: LanguageModelUsage;
  maxTokens?: number;
  onResolveApproval(approvalId: string, decision: ApprovalDecision): void;
  onSend(content: string): void;
  onInterrupt(): void;
}

export function InputBox({
  streaming,
  initialized,
  pendingApprovals,
  tokenUsage,
  maxTokens = 128_000,
  onResolveApproval,
  onSend,
  onInterrupt,
}: InputBoxProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const text = content.trim();
    if (!text || streaming || !initialized) return;
    onSend(text);
    setContent('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [content, streaming, initialized, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const placeholder = initialized ? 'Message...' : 'Connecting...';

  return (
    <div>
      <ApprovalBar approvals={pendingApprovals ?? []} onResolve={onResolveApproval} />
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={streaming || !initialized}
        placeholder={placeholder}
        rows={1}
        className="w-full bg-transparent text-sm text-tx placeholder-tx3 outline-none resize-none min-h-[24px] max-h-[160px]"
      />
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3">
          {tokenUsage && <TokenStatsBadge usage={tokenUsage} maxTokens={maxTokens} />}
        </div>
        <div className="flex items-center gap-2">
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-err text-white text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Square size={12} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!content.trim() || !initialized}
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                content.trim() && initialized
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
    </div>
  );
}
```

- [ ] **Step 2: 运行类型检查**

Run:
```bash
pnpm --filter rem-agent-web typecheck
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/input-box.tsx
git commit -m "refactor: InputBox renders inner block with token stats in toolbar

Removes outer card container; token stats now live alongside action buttons.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 创建 ChatComposer 组件

**Files:**
- Create: `packages/web/src/components/chat/chat-composer.tsx`

**Goal:** 实现统一的输入区块容器，只负责外层卡片和 Agent 状态栏。

- [ ] **Step 1: 实现 ChatComposer**

创建 `packages/web/src/components/chat/chat-composer.tsx`：

```tsx
'use client';

import type { SessionActivity } from 'rem-agent-bridge';
import type { ApprovalDecision, ApprovalRequest, LanguageModelUsage } from 'rem-agent-core';
import { ActivityBar } from './activity-bar';
import { InputBox } from './input-box';

export interface ChatComposerProps {
  streaming: boolean;
  initialized: boolean;
  activity?: SessionActivity;
  tokenUsage?: LanguageModelUsage;
  maxTokens?: number;
  pendingApprovals?: ApprovalRequest[];
  onSend(content: string): void;
  onInterrupt(): void;
  onResolveApproval(approvalId: string, decision: ApprovalDecision): void;
}

export function ChatComposer({
  streaming,
  initialized,
  activity,
  tokenUsage,
  maxTokens = 128_000,
  pendingApprovals,
  onSend,
  onInterrupt,
  onResolveApproval,
}: ChatComposerProps) {
  return (
    <div className="bg-card border border-bd rounded-card overflow-hidden">
      {/* Agent status bar */}
      <div className="px-4 py-2.5 border-b border-bd min-h-[38px] flex items-center">
        <ActivityBar activity={activity} showIdle />
      </div>

      {/* Input block: approvals + textarea + token stats + actions */}
      <div className="px-4 py-3">
        <InputBox
          streaming={streaming}
          initialized={initialized}
          pendingApprovals={pendingApprovals}
          tokenUsage={tokenUsage}
          maxTokens={maxTokens}
          onResolveApproval={onResolveApproval}
          onSend={onSend}
          onInterrupt={onInterrupt}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行类型检查**

Run:
```bash
pnpm --filter rem-agent-web typecheck
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/chat-composer.tsx
git commit -m "feat: add ChatComposer unified input block container

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 更新 ChatPanel 使用 ChatComposer

**Files:**
- Modify: `packages/web/src/components/chat/chat-panel.tsx`

**Goal:** 简化 `ChatPanel`，用 `ChatComposer` 替换原来的三组件组合。

- [ ] **Step 1: 修改 ChatPanel**

修改 `packages/web/src/components/chat/chat-panel.tsx`：

```tsx
'use client';

import { MessageList } from './message-list';
import { ChatComposer } from './chat-composer';
import type { UIMessage, SessionActivity } from '@/lib/types';
import type { ApprovalDecision, ApprovalRequest, LanguageModelUsage } from 'rem-agent-core';

export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

interface ChatPanelProps {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingApprovals?: ApprovalRequest[];
  initialized: boolean;
  tokenUsage?: LanguageModelUsage;
  maxTokens?: number;
  onSend(content: string): void;
  onInterrupt(): void;
  onResolveApproval(approvalId: string, decision: ApprovalDecision): void;
}

export function ChatPanel({
  messages,
  status,
  error,
  activity,
  pendingApprovals,
  initialized,
  tokenUsage,
  maxTokens = 128_000,
  onSend,
  onInterrupt,
  onResolveApproval,
}: ChatPanelProps) {
  const streaming = status === 'streaming' || status === 'loading';

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
        {error && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">{error}</span>
        )}
      </header>
      <MessageList messages={messages} onSend={onSend} />
      <div className="max-w-3xl mx-auto w-full px-4 pb-4">
        <ChatComposer
          streaming={streaming}
          initialized={initialized}
          activity={activity}
          tokenUsage={tokenUsage}
          maxTokens={maxTokens}
          pendingApprovals={pendingApprovals}
          onSend={onSend}
          onInterrupt={onInterrupt}
          onResolveApproval={onResolveApproval}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行类型检查**

Run:
```bash
pnpm --filter rem-agent-web typecheck
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/chat-panel.tsx
git commit -m "refactor: ChatPanel uses ChatComposer for unified input block

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 为 ChatComposer 添加测试

**Files:**
- Create: `packages/web/src/components/chat/chat-composer.test.tsx`

**Goal:** 验证 `ChatComposer` 正确组合各子组件，并在不同状态下显示预期内容。

- [ ] **Step 1: 写测试**

创建 `packages/web/src/components/chat/chat-composer.test.tsx`：

```typescript
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatComposer } from './chat-composer';
import type { LanguageModelUsage } from 'rem-agent-core';

const baseUsage: LanguageModelUsage = {
  promptTokens: 6789,
  completionTokens: 5556,
  totalTokens: 12345,
};

const noop = () => {};

describe('ChatComposer', () => {
  it('renders idle status and disabled send button', () => {
    render(
      <ChatComposer
        streaming={false}
        initialized
        activity="idle"
        tokenUsage={baseUsage}
        onSend={noop}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText(/12,345 tokens/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Message...')).toBeInTheDocument();
  });

  it('shows stop button while streaming', () => {
    render(
      <ChatComposer
        streaming
        initialized
        activity="thinking"
        tokenUsage={baseUsage}
        onSend={noop}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('renders approval requests inside the block', () => {
    render(
      <ChatComposer
        streaming={false}
        initialized
        activity="idle"
        tokenUsage={baseUsage}
        pendingApprovals={[
          {
            approvalId: 'a1',
            title: 'Approve file write',
            description: 'Modify /src/config.ts',
            severity: 'warning',
            allowedDecisions: ['allow-once', 'deny'],
          },
        ]}
        onSend={noop}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    expect(screen.getByText('Approve file write')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /allow once/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('calls onSend when user types and clicks send', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();

    render(
      <ChatComposer
        streaming={false}
        initialized
        activity="idle"
        onSend={onSend}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    const textarea = screen.getByPlaceholderText('Message...');
    await user.type(textarea, 'Hello');

    const sendButton = screen.getByRole('button', { name: /send/i });
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('calls onInterrupt when stop is clicked', async () => {
    const onInterrupt = vi.fn();
    const user = userEvent.setup();

    render(
      <ChatComposer
        streaming
        initialized
        activity="outputting"
        onSend={noop}
        onInterrupt={onInterrupt}
        onResolveApproval={noop}
      />
    );

    const stopButton = screen.getByRole('button', { name: /stop/i });
    await user.click(stopButton);

    expect(onInterrupt).toHaveBeenCalled();
  });

  it('does not render token stats when tokenUsage is undefined', () => {
    render(
      <ChatComposer
        streaming={false}
        initialized
        activity="idle"
        onSend={noop}
        onInterrupt={noop}
        onResolveApproval={noop}
      />
    );

    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run:
```bash
pnpm vitest run packages/web/src/components/chat/chat-composer.test.tsx
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/chat-composer.test.tsx
git commit -m "test: add ChatComposer render and interaction tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 运行完整验证

**Files:** 无

**Goal:** 确保修改没有破坏现有功能。

- [ ] **Step 1: 运行所有测试**

Run:
```bash
pnpm test
```

Expected: 所有测试通过（包括新添加的 web 组件测试和已有的 core 测试）。

- [ ] **Step 2: 运行类型检查**

Run:
```bash
pnpm typecheck
```

Expected: 所有包类型检查通过。

- [ ] **Step 3: 启动开发服务器做视觉确认**

Run:
```bash
pnpm --filter rem-agent-web dev
```

在浏览器中打开 http://localhost:3000，检查：
1. 底部输入区块是否为统一卡片。
2. Agent 状态是否在卡片顶部。
3. Token 统计是否在卡片底部与操作按钮同一行。
4. Approval 请求是否在卡片内部正确显示。
5. streaming 时 Stop 按钮是否出现。

- [ ] **Step 4: Commit（如有任何修复）**

如果在验证中发现并修复了问题，单独提交：

```bash
git add <files>
git commit -m "fix: address validation issues in ChatComposer integration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 统一卡片容器 → Task 5
- ✅ Agent 状态在顶部 → Task 5
- ✅ Token 统计在底部与按钮同一行 → Task 4
- ✅ Approval 请求在卡片内部 → Task 4 / Task 5
- ✅ ActivityBar idle 占位 → Task 2
- ✅ InputBox 移除外层容器 → Task 4
- ✅ ChatPanel 使用 ChatComposer → Task 6
- ✅ 视觉规范（颜色、圆角等）→ Task 4 / Task 5

**2. Placeholder scan:**
- 无 TBD/TODO。
- 所有代码步骤包含完整代码。
- 所有命令包含预期输出。

**3. Type consistency：**
- `ChatComposerProps` 中的类型与 `ChatPanelProps` 一致。
- `ActivityBar` 新增的 `showIdle` prop 在 `ChatComposer` 中正确传入。
- `InputBox` 新增的 `tokenUsage` / `maxTokens` props 与 `TokenStatsBadge` 一致。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-composer-unified-block-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
