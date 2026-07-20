# 输入框体验优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复输入框 IME 误发送与视觉问题，并支持文本文件（内联）与图片（多模态）附件。

**Architecture:** 分层推进 —— core 仅放宽 `UserInput.content` 类型透传给 pi-ai；bridge 协议 `RunRequest.content` / `IAgentService.run` 同步放宽；web 端完成 IME 修复、附件 chips UI、发送组装与历史图片渲染。

**Tech Stack:** TypeScript、React 19、Next.js 15、vitest、@testing-library/react、pi-ai（`TextContent` / `ImageContent`）

**Spec:** `docs/superpowers/specs/2026-07-20-input-box-ux-design.md`

**与 spec 的一处偏差：** spec 第 4 节提到用 toast 提示附件错误；web 包内没有 toast 设施，改为输入区内联错误文本（`text-err text-xs`），与现有错误展示模式一致。

---

### Task 1: Core — `UserInputContent` 类型与 runAgent 透传

**Files:**
- Modify: `packages/core/src/types.ts:33-36`
- Modify: `packages/core/src/index.ts:3`
- Test: `packages/core/tests/run-agent.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/tests/run-agent.test.ts` 的 `describe('runAgent')` 内追加（文件已有 `createMockContextBase` 与导入，直接复用）：

```typescript
it('passes through multipart user content (text + image) to the session', async () => {
  const saveMock = vi.fn();
  const base = createMockContextBase();
  const mockCtx = {
    ...base,
    sessionProvider: { ...base.sessionProvider, save: saveMock },
    loopStrategy: {
      run: async () => ({
        content: 'ok',
        usage: { ...emptyUsage, input: 1, output: 1, totalTokens: 2 },
      }),
    },
  } as unknown as AgentContext;

  const parts = [
    { type: 'text' as const, text: 'look at this' },
    { type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' },
  ];

  const { runAgent } = await import('../src/run-agent.js');
  const result = runAgent({
    input: { content: parts, timestamp: new Date() },
    sessionId: 'test-session-parts',
    ctx: mockCtx,
    agentState: new AgentState(),
  });
  for await (const _chunk of result.stream.fullStream) {
    // drain
  }
  await result.output;

  expect(saveMock).toHaveBeenCalled();
  const savedSession = saveMock.mock.calls[0][0] as { conversation: Array<{ role: string; content: unknown }> };
  const last = savedSession.conversation[savedSession.conversation.length - 1];
  expect(last.role).toBe('user');
  expect(last.content).toEqual(parts);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter rem-agent-core test -- run-agent.test.ts -t "multipart"`
Expected: FAIL（`parts` 数组传给 `content: string` 类型报错，或断言不成立）

- [ ] **Step 3: 放宽类型**

`packages/core/src/types.ts` 顶部已有 pi-ai 类型导入区域；将 `UserInput` 改为：

```typescript
import type { TextContent, ImageContent } from '@earendil-works/pi-ai';

export type UserInputContent = string | (TextContent | ImageContent)[];

export interface UserInput {
  content: UserInputContent;
  timestamp?: Date;
}
```

`packages/core/src/index.ts:3` 的导出改为（追加 `ImageContent` 与 `UserInputContent`）：

```typescript
export type { Message, TextContent, ImageContent, ThinkingContent, ToolCall, Usage, AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
export type { UserInputContent } from './types.js';
```

（`UserInput` 若已在 index 导出则保持不变；`run-agent.ts:96` 无需改动，`pi.Message` 的 user content 天然支持该联合类型。）

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter rem-agent-core test -- run-agent.test.ts`
Expected: PASS（含新用例）

- [ ] **Step 5: 类型检查**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts packages/core/tests/run-agent.test.ts
git commit -m "feat(core): widen UserInput.content to support multimodal parts"
```

---

### Task 2: Bridge — 协议与实现放宽

**Files:**
- Modify: `packages/bridge/src/types.ts:29-32`
- Modify: `packages/bridge/src/agent-service.interface.ts:13`
- Modify: `packages/bridge/src/agent.ts:66-95`
- Modify: `packages/bridge/src/agent-remote-service.ts:39-49`
- Test: `packages/bridge/tests/client.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/bridge/tests/client.test.ts` 的 `describe('AgentRemoteService')` 内追加：

```typescript
it('posts multipart content parts as JSON body', async () => {
  const fetchMock = vi.fn();
  global.fetch = fetchMock as any;
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

  const parts = [
    { type: 'text' as const, text: 'hi' },
    { type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' },
  ];
  const client = new AgentRemoteService('http://localhost:8321');
  await client.run(WORKSPACE, 's1', parts);

  expect(fetchMock).toHaveBeenCalledWith(
    `http://localhost:8321/api/agent/run?workspace=${encodeURIComponent(WORKSPACE)}`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', content: parts }),
    }),
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter rem-agent-bridge test -- client.test.ts -t "multipart"`
Expected: FAIL（类型错误：`parts` 不可赋值给 `input: string`）

- [ ] **Step 3: 放宽 bridge 类型**

`packages/bridge/src/types.ts:29-32`：

```typescript
import type { UserInputContent } from 'rem-agent-core';

export interface RunRequest {
  sessionId: string;
  content: UserInputContent;
}
```

`packages/bridge/src/agent-service.interface.ts:13`：

```typescript
run(workspace: string, sessionId: string, input: UserInputContent): Promise<void>;
```

（文件顶部补充 `import type { UserInputContent } from 'rem-agent-core';`）

`packages/bridge/src/agent.ts:66-95`，`run` 签名与日志：

```typescript
async run(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
  this.ensureInitialized();

  if (this.agentState.isRunning(sessionId)) {
    throw new ServiceError('Session is already running', 409);
  }

  const abortController = this.agentState.startRun(sessionId, workspace);
  const inputLength = typeof input === 'string' ? input.length : input.length;
  log('agent:lifecycle', 'run started', { sessionId, workspace, inputLength });

  let result: ReturnType<typeof coreRunAgent>;
  try {
    result = coreRunAgent({
      input: { content: input, timestamp: new Date() },
      sessionId,
      signal: abortController.signal,
      ctx: this.ctx!,
      agentState: this.agentState,
      workspace,
      workspaceRoot: workspace,
    });
  // ...其余不变
```

（`agent.ts` 顶部补充 `UserInputContent` 的 type import，加入已有的 `rem-agent-core` import 列表。）

`packages/bridge/src/agent-remote-service.ts:39-49`：

```typescript
async run(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
  const response = await fetch(`${this.resolvedBaseUrl}/api/agent/run?${AgentRemoteService.wsQuery(workspace)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content: input } satisfies RunRequest),
  });

  if (!response.ok) {
    throw new Error(`Agent run failed: ${response.status}`);
  }
}
```

（import 列表加入 `RunRequest` 与 `UserInputContent`。）

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter rem-agent-bridge test`
Expected: PASS（含新用例；旧用例传 string 仍兼容）

- [ ] **Step 5: 类型检查**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/types.ts packages/bridge/src/agent-service.interface.ts packages/bridge/src/agent.ts packages/bridge/src/agent-remote-service.ts packages/bridge/tests/client.test.ts
git commit -m "feat(bridge): accept multimodal UserInputContent in run protocol"
```

---

### Task 3: Bridge + Web — 历史消息图片透传与缩略图渲染

**Files:**
- Modify: `packages/bridge/src/types.ts:6`
- Modify: `packages/bridge/src/agent-session.ts:155-165`
- Test: `packages/bridge/tests/agent-session.test.ts`
- Modify: `packages/web/src/components/chat/message-item.tsx:68-81`

- [ ] **Step 1: 写失败测试（bridge）**

查看 `packages/bridge/tests/agent-session.test.ts` 中已有的 `messageToContentBlocks` 相关用例模式，追加一条（若该函数未直接导出，则通过已有的 getMessages 链路构造含 image 块的 user message 断言；以下以直接可行为准调整导入路径）：

```typescript
it('passes through user image blocks instead of collapsing to [image]', async () => {
  // 构造一个含 image content 的 user pi.Message，走 messageToContentBlocks 转换
  // 断言返回的 UiContentBlock 包含 { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
});
```

实现时参考该文件已有 user message 用例的构造方式；关键断言：

```typescript
expect(blocks).toContainEqual({ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter rem-agent-bridge test -- agent-session.test.ts -t "image"`
Expected: FAIL（当前输出 `{ type: 'text', text: '[image]' }`）

- [ ] **Step 3: 实现透传**

`packages/bridge/src/types.ts:6`：

```typescript
import type { TextContent, ThinkingContent, ToolCall, ImageContent } from 'rem-agent-core';

export type UiContentBlock = TextContent | ThinkingContent | ToolCall | ImageContent;
```

`packages/bridge/src/agent-session.ts:157-165` user 分支改为：

```typescript
function messageToContentBlocks(message: Message): UiContentBlock[] {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ type: 'text', text: message.content }];
    }
    return message.content
      .filter((c): c is TextContent | ImageContent => c.type === 'text' || c.type === 'image')
      .map((c) => (c.type === 'text' ? { type: 'text' as const, text: c.text } : { type: 'image' as const, data: c.data, mimeType: c.mimeType }));
  }
  // ...其余不变
```

- [ ] **Step 4: 运行 bridge 测试确认通过**

Run: `pnpm --filter rem-agent-bridge test`
Expected: PASS

- [ ] **Step 5: Web 渲染图片缩略图**

`packages/web/src/components/chat/message-item.tsx` 用户气泡分支（68-81 行）改为：

```tsx
{message.parts.map((part, i) => {
  if (part.type === 'text') {
    return <span key={i}>{part.text}</span>;
  }
  if (part.type === 'image') {
    return (
      <img
        key={i}
        src={`data:${part.mimeType};base64,${part.data}`}
        alt="attachment"
        className="block max-w-[240px] max-h-[180px] rounded-lg mb-1"
      />
    );
  }
  return null;
})}
```

- [ ] **Step 6: 类型检查 + web 测试**

Run: `pnpm typecheck && pnpm --filter rem-agent-web test 2>/dev/null || pnpm --filter ./packages/web test`
Expected: 类型检查通过，测试全绿

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/types.ts packages/bridge/src/agent-session.ts packages/bridge/tests/agent-session.test.ts packages/web/src/components/chat/message-item.tsx
git commit -m "feat(bridge,web): pass through and render user image blocks in history"
```

---

### Task 4: Web — run route 接受 UserInputContent

**Files:**
- Modify: `packages/web/src/app/api/agent/run/route.ts:16-46`

- [ ] **Step 1: 修改 route**

```typescript
import type { UserInputContent } from 'rem-agent-core';

export async function POST(request: NextRequest) {
  let body: { sessionId?: string } | undefined;
  let workspace: string | undefined;

  try {
    body = await request.json();
    const { sessionId, content } = body as {
      sessionId: string;
      content?: UserInputContent;
    };
    workspace = getWorkspace(request);

    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');

    const isEmpty =
      content === undefined ||
      content === null ||
      (typeof content === 'string' && !content) ||
      (Array.isArray(content) && content.length === 0);
    if (!sessionId || isEmpty) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    const contentLength = typeof content === 'string' ? content.length : content.length;
    log('api:run', 'run request', { sessionId, workspace, contentLength });
    await agentService.run(workspace, sessionId, content);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    log('api:run', 'run failed', { sessionId: body?.sessionId, workspace, error: message });
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: 类型检查 + 测试**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/agent/run/route.ts
git commit -m "feat(web): accept multimodal content in /api/agent/run"
```

---

### Task 5: Web — IME 修复与输入框最小高度

**Files:**
- Modify: `packages/web/src/components/chat/input-box.tsx`
- Test: `packages/web/src/components/chat/input-box.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

新建 `packages/web/src/components/chat/input-box.test.tsx`：

```tsx
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputBox } from './input-box';

const noop = () => {};

function renderInputBox(overrides: Partial<Parameters<typeof InputBox>[0]> = {}) {
  return render(
    <InputBox
      streaming={false}
      initialized
      onSend={noop}
      onInterrupt={noop}
      onResolveApproval={noop}
      {...overrides}
    />,
  );
}

describe('InputBox IME handling', () => {
  it('does not send on Enter during IME composition', async () => {
    const onSend = vi.fn();
    renderInputBox({ onSend });

    const textarea = screen.getByPlaceholderText('Message...');
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'nihao' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends on Enter after composition ends', async () => {
    const onSend = vi.fn();
    renderInputBox({ onSend });

    const textarea = screen.getByPlaceholderText('Message...');
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '你好' } });
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('你好');
  });

  it('sends on Enter for plain (non-IME) input', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    renderInputBox({ onSend });

    const textarea = screen.getByPlaceholderText('Message...');
    await user.type(textarea, 'Hello{Enter}');

    expect(onSend).toHaveBeenCalledWith('Hello');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./packages/web test -- input-box.test.tsx`
Expected: FAIL（"does not send on Enter during IME composition" 用例失败，其余可能已通过）

- [ ] **Step 3: 实现 IME 修复与最小高度**

`packages/web/src/components/chat/input-box.tsx`：

```tsx
import { useState, useRef, useCallback, KeyboardEvent, CompositionEvent } from 'react';
```

组件内新增 ref：

```tsx
const composingRef = useRef(false);

const handleCompositionStart = () => {
  composingRef.current = true;
};

const handleCompositionEnd = () => {
  composingRef.current = false;
};
```

`handleKeyDown` 改为：

```tsx
const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (composingRef.current || e.nativeEvent.isComposing) return;
    e.preventDefault();
    handleSend();
  }
};
```

textarea 增加两个 handler 并调整最小高度 class：

```tsx
<textarea
  ref={textareaRef}
  value={content}
  onChange={handleChange}
  onKeyDown={handleKeyDown}
  onCompositionStart={handleCompositionStart}
  onCompositionEnd={handleCompositionEnd}
  disabled={streaming || !initialized}
  placeholder={placeholder}
  rows={2}
  className="w-full bg-transparent text-sm text-tx placeholder-tx3 outline-none resize-none min-h-[48px] max-h-[160px]"
/>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./packages/web test`
Expected: PASS（含既有 `chat-composer.test.tsx`）

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/input-box.tsx packages/web/src/components/chat/input-box.test.tsx
git commit -m "fix(web): prevent IME composition Enter from sending; taller input box"
```

---

### Task 6: Web — 附件 chips、粘贴/拖拽/选择与发送组装

**Files:**
- Create: `packages/web/src/lib/attachments.ts`
- Create: `packages/web/src/components/chat/attachment-chips.tsx`
- Modify: `packages/web/src/components/chat/input-box.tsx`
- Modify: `packages/web/src/components/chat/chat-composer.tsx:16`
- Modify: `packages/web/src/components/chat/chat-panel.tsx:26`
- Modify: `packages/web/src/components/chat/message-list.tsx:10`
- Modify: `packages/web/src/lib/agent-bus.ts:95-97,122-127`
- Modify: `packages/web/src/lib/use-agents.ts:613-642`
- Test: `packages/web/src/components/chat/input-box.test.tsx`（追加）
- Test: `packages/web/src/lib/attachments.test.ts`（新建）

- [ ] **Step 1: 写 attachments 工具的失败测试**

新建 `packages/web/src/lib/attachments.test.ts`：

```typescript
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { buildUserInputContent, isTextFile, TEXT_FILE_MAX_BYTES, IMAGE_MAX_BYTES } from './attachments';

describe('isTextFile', () => {
  it('accepts text MIME and known extensions', () => {
    expect(isTextFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(true);
    expect(isTextFile(new File(['x'], 'b.ts', { type: '' }))).toBe(true);
    expect(isTextFile(new File(['x'], 'c.png', { type: 'image/png' }))).toBe(false);
    expect(isTextFile(new File(['x'], 'd.bin', { type: 'application/octet-stream' }))).toBe(false);
  });
});

describe('buildUserInputContent', () => {
  it('returns plain string when only text', () => {
    expect(buildUserInputContent('hello', [], [])).toBe('hello');
  });

  it('inlines text files with <file> fences', () => {
    const result = buildUserInputContent('see this', [{ name: 'a.ts', text: 'const x = 1;' }], []);
    expect(result).toBe('<file name="a.ts">\nconst x = 1;\n</file>\n\nsee this');
  });

  it('returns parts array when images present', () => {
    const result = buildUserInputContent('look', [], [{ name: 'p.png', data: 'aGVsbG8=', mimeType: 'image/png' }]);
    expect(result).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);
  });

  it('combines text files and images', () => {
    const result = buildUserInputContent(
      'ctx',
      [{ name: 'a.md', text: '# doc' }],
      [{ name: 'p.png', data: 'aGVsbG8=', mimeType: 'image/png' }],
    );
    expect(result).toEqual([
      { type: 'text', text: '<file name="a.md">\n# doc\n</file>\n\nctx' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);
  });

  it('exports size limits', () => {
    expect(TEXT_FILE_MAX_BYTES).toBe(100 * 1024);
    expect(IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./packages/web test -- attachments.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `attachments.ts`**

新建 `packages/web/src/lib/attachments.ts`：

```typescript
import type { UserInputContent } from 'rem-agent-core';

export const TEXT_FILE_MAX_BYTES = 100 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_FILES = 5;
export const MAX_IMAGES = 4;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs',
  'java', 'c', 'cpp', 'h', 'hpp', 'css', 'html', 'xml', 'yml', 'yaml', 'toml',
  'sh', 'bash', 'zsh', 'log', 'csv', 'sql', 'vue', 'svelte', 'env', 'ini', 'conf',
]);

export interface TextAttachment {
  name: string;
  text: string;
}

export interface ImageAttachment {
  name: string;
  data: string; // base64，不含 data: 前缀
  mimeType: string;
  dataUrl: string; // 用于 chip 缩略图
}

export function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (file.type === 'application/json') return true;
  if (file.type && file.type !== '') return false;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.has(ext);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readFileAsImageAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      resolve({
        name: file.name,
        data: dataUrl.slice(comma + 1),
        mimeType: file.type || 'image/png',
        dataUrl,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function buildUserInputContent(
  text: string,
  textFiles: TextAttachment[],
  images: ImageAttachment[],
): UserInputContent {
  const prefix = textFiles.map((f) => `<file name="${f.name}">\n${f.text}\n</file>`).join('\n');
  const fullText = prefix ? `${prefix}\n\n${text}` : text;
  if (images.length === 0) return fullText;
  return [
    { type: 'text', text: fullText },
    ...images.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType })),
  ];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./packages/web test -- attachments.test.ts`
Expected: PASS

- [ ] **Step 5: 实现 `attachment-chips.tsx`**

新建 `packages/web/src/components/chat/attachment-chips.tsx`：

```tsx
'use client';

import { X, FileText } from 'lucide-react';
import type { TextAttachment, ImageAttachment } from '@/lib/attachments';

interface AttachmentChipsProps {
  textFiles: TextAttachment[];
  images: ImageAttachment[];
  onRemoveText(index: number): void;
  onRemoveImage(index: number): void;
}

export function AttachmentChips({ textFiles, images, onRemoveText, onRemoveImage }: AttachmentChipsProps) {
  if (textFiles.length === 0 && images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {images.map((img, i) => (
        <div key={`img-${i}`} className="relative group">
          <img src={img.dataUrl} alt={img.name} className="h-12 w-12 object-cover rounded-lg border border-bd" />
          <button
            type="button"
            aria-label={`Remove ${img.name}`}
            onClick={() => onRemoveImage(i)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-tx3 text-bg flex items-center justify-center"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      {textFiles.map((f, i) => (
        <div key={`file-${i}`} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-bd text-xs text-tx2">
          <FileText size={12} />
          <span className="max-w-[160px] truncate">{f.name}</span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemoveText(i)} className="text-tx3 hover:text-tx">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

（颜色 token `text-tx2` 若不存在则参照项目内既有 token 命名调整，以 typecheck 与视觉一致为准。）

- [ ] **Step 6: 改造 `input-box.tsx` 支持附件**

关键变更（完整组件基于 Task 5 后的版本）：

```tsx
import { useState, useRef, useCallback, KeyboardEvent, ClipboardEvent, DragEvent } from 'react';
import { ArrowUp, Square, Plus } from 'lucide-react';
import type { UserInputContent } from 'rem-agent-core';
import {
  isTextFile, isImageFile, readFileAsText, readFileAsImageAttachment,
  buildUserInputContent,
  TEXT_FILE_MAX_BYTES, IMAGE_MAX_BYTES, MAX_TEXT_FILES, MAX_IMAGES,
  type TextAttachment, type ImageAttachment,
} from '@/lib/attachments';
import { AttachmentChips } from './attachment-chips';
```

props 签名：`onSend(content: UserInputContent): void | Promise<void>`。

组件内状态与发送：

```tsx
const [textFiles, setTextFiles] = useState<TextAttachment[]>([]);
const [images, setImages] = useState<ImageAttachment[]>([]);
const [attachError, setAttachError] = useState<string | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);

const addFiles = useCallback(async (files: File[]) => {
  setAttachError(null);
  for (const file of files) {
    try {
      if (isImageFile(file)) {
        if (file.size > IMAGE_MAX_BYTES) { setAttachError(`${file.name} exceeds 5MB limit`); continue; }
        if (images.length >= MAX_IMAGES) { setAttachError(`At most ${MAX_IMAGES} images`); break; }
        const img = await readFileAsImageAttachment(file);
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, img]));
      } else if (isTextFile(file)) {
        if (file.size > TEXT_FILE_MAX_BYTES) { setAttachError(`${file.name} exceeds 100KB limit`); continue; }
        const text = await readFileAsText(file);
        setTextFiles((prev) => (prev.length >= MAX_TEXT_FILES ? prev : [...prev, { name: file.name, text }]));
      } else {
        setAttachError(`${file.name}: unsupported file type`);
      }
    } catch {
      setAttachError(`Failed to read ${file.name}`);
    }
  }
}, [images.length]);

const handleSend = useCallback(async () => {
  const text = content.trim();
  if ((!text && textFiles.length === 0 && images.length === 0) || streaming || !initialized) return;
  const payload = buildUserInputContent(text, textFiles, images);
  const snapshot = { text: content, textFiles, images };
  setContent('');
  setTextFiles([]);
  setImages([]);
  if (textareaRef.current) textareaRef.current.style.height = 'auto';
  try {
    await onSend(payload);
  } catch {
    setContent(snapshot.text);
    setTextFiles(snapshot.textFiles);
    setImages(snapshot.images);
  }
}, [content, textFiles, images, streaming, initialized, onSend]);
```

粘贴 / 拖拽 / 文件选择 handler：

```tsx
const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length > 0) {
    e.preventDefault();
    void addFiles(files);
  }
};

const handleDrop = (e: DragEvent<HTMLDivElement>) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length > 0) void addFiles(files);
};

const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files ?? []);
  if (files.length > 0) void addFiles(files);
  e.target.value = '';
};
```

JSX 结构（在最外层 div 上挂 drop；附件区在 ApprovalBar 之下、textarea 之上）：

```tsx
<div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
  <ApprovalBar approvals={pendingApprovals ?? []} onResolve={onResolveApproval} />
  <AttachmentChips
    textFiles={textFiles}
    images={images}
    onRemoveText={(i) => setTextFiles((prev) => prev.filter((_, idx) => idx !== i))}
    onRemoveImage={(i) => setImages((prev) => prev.filter((_, idx) => idx !== i))}
  />
  {attachError && <div className="text-err text-xs mb-1">{attachError}</div>}
  <textarea
    // ...Task 5 的属性 + onPaste={handlePaste}
  />
  <input
    ref={fileInputRef}
    type="file"
    multiple
    hidden
    accept="image/*,text/*,.ts,.tsx,.js,.jsx,.json,.md,.py,.go,.rs,.java,.c,.cpp,.h,.css,.html,.xml,.yml,.yaml,.toml,.sh,.log,.csv,.sql"
    onChange={handleFileInputChange}
  />
  {/* 底栏：将原内联 svg 的 + 按钮替换为 */}
  <button
    type="button"
    disabled={!initialized}
    onClick={() => fileInputRef.current?.click()}
    className="p-1.5 rounded-lg text-tx3 hover:bg-bd hover:text-tx disabled:opacity-50 transition-colors"
    aria-label="Add attachment"
  >
    <Plus size={18} />
  </button>
  {/* send 按钮 disabled 条件改为：(!content.trim() && textFiles.length === 0 && images.length === 0) || !initialized */}
</div>
```

- [ ] **Step 7: 放宽调用链签名**

`packages/web/src/components/chat/chat-composer.tsx:16`、`chat-panel.tsx:26`、`message-list.tsx:10`：

```typescript
onSend(content: UserInputContent): void | Promise<void>;
```

（分别从 `rem-agent-core` import type `UserInputContent`。message-list 的 hint 点击传 string，天然兼容。）

`packages/web/src/lib/agent-bus.ts:95-97` 与 `122-127`：

```typescript
async send(workspace: string, sessionId: string, content: UserInputContent) {
  await service.run(workspace, sessionId, content);
},
```

`packages/web/src/lib/use-agents.ts:613-642` 的 `send`：

```typescript
const send = useCallback(
  async (content: UserInputContent) => {
    if (!currentId) return;
    const map = sessionMapRef.current;
    const state = map.get(currentId);
    if (!state) return;

    const parts: UIMessage['parts'] =
      typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : content.map((p) => (p.type === 'text' ? { type: 'text' as const, text: p.text } : { type: 'image' as const, data: p.data, mimeType: p.mimeType }));

    const userMsg: UIMessage = {
      id: generateUUID(),
      role: 'user',
      parts,
      status: 'done',
    };

    state.messages = [...state.messages, userMsg];
    state.status = 'loading';
    state.error = null;
    state.activity = 'pending';
    notifyChange();

    try {
      await bus.send(workspace, currentId, content);
    } catch (err) {
      state.status = 'error';
      state.error = err instanceof Error ? err.message : 'Send failed';
      notifyChange();
      throw err; // 让 InputBox 恢复草稿
    }
  },
  [currentId, bus, notifyChange, workspace],
);
```

- [ ] **Step 8: 追加 InputBox 附件测试**

在 `input-box.test.tsx` 追加：

```tsx
describe('InputBox attachments', () => {
  it('adds an image chip on paste and sends parts', async () => {
    const onSend = vi.fn();
    renderInputBox({ onSend });

    const textarea = screen.getByPlaceholderText('Message...');
    const file = new File(['fake-png-bytes'], 'p.png', { type: 'image/png' });
    fireEvent.paste(textarea, { clipboardData: { files: [file] } });

    expect(await screen.findByAltText('p.png')).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'look' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
    const payload = onSend.mock.calls[0][0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0]).toEqual({ type: 'text', text: 'look' });
    expect(payload[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('removes a chip via the x button', async () => {
    renderInputBox();
    const textarea = screen.getByPlaceholderText('Message...');
    const file = new File(['fake'], 'p.png', { type: 'image/png' });
    fireEvent.paste(textarea, { clipboardData: { files: [file] } });

    const removeBtn = await screen.findByRole('button', { name: /remove p\.png/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByAltText('p.png')).not.toBeInTheDocument();
  });

  it('rejects non-text non-image files with an inline error', async () => {
    renderInputBox();
    const textarea = screen.getByPlaceholderText('Message...');
    const file = new File(['x'], 'a.bin', { type: 'application/octet-stream' });
    fireEvent.paste(textarea, { clipboardData: { files: [file] } });

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: 全量验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/lib/attachments.ts packages/web/src/lib/attachments.test.ts packages/web/src/components/chat/attachment-chips.tsx packages/web/src/components/chat/input-box.tsx packages/web/src/components/chat/input-box.test.tsx packages/web/src/components/chat/chat-composer.tsx packages/web/src/components/chat/chat-panel.tsx packages/web/src/components/chat/message-list.tsx packages/web/src/lib/agent-bus.ts packages/web/src/lib/use-agents.ts
git commit -m "feat(web): support text file and image attachments in chat input"
```

---

## 自查记录

- **Spec 覆盖**：IME 修复 → Task 5；最小高度 → Task 5；文本文件 → Task 6；图片多模态链路 → Task 1/2/3/4/6；失败恢复 → Task 6（`use-agents.send` rethrow + InputBox 快照恢复）；测试 → 各 Task 内。
- **类型一致性**：`UserInputContent` 统一定义于 core 并经 bridge/web 引用；`TextAttachment` / `ImageAttachment` 仅在 web `attachments.ts` 定义，chips 与 input-box 共用。
- **已知余量**：`AttachmentChips` 的颜色 token（`text-tx2`、`bg-tx3` 等）以实现时项目内实际存在的 token 为准。
