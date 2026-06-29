# Web Chat UI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在 `packages/web/` 中构建 React + Next.js 15 App Router 的 Agent 聊天 Web UI，替代现有 bridge + server 包。

**架构：** Next.js API Routes 直接 import `rem-agent-core` 的 `CoreAgent`，SSE 流通过 `ReadableStream` 直出；前端用 Zustand 管理会话状态，react-virtuoso 做虚拟滚动，shadcn/ui 做组件基础。

**技术栈：** Next.js 15, React 19, TypeScript 5.4, Tailwind CSS 4, shadcn/ui (lucide-react), Zustand v5, react-virtuoso v4, react-markdown + rehype-highlight + remark-gfm, highlight.js

---

## 文件结构总览

```
packages/web/
├── package.json
├── next.config.ts
├── tsconfig.json
├── components.json
├── postcss.config.mjs
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/
│   │       ├── agent/run/route.ts
│   │       ├── sessions/route.ts
│   │       ├── sessions/[id]/route.ts
│   │       └── stream/[sessionId]/route.ts
│   ├── components/
│   │   ├── chat/
│   │   │   ├── input-box.tsx
│   │   │   ├── thinking-bar.tsx
│   │   │   ├── reasoning-block.tsx
│   │   │   ├── tool-call-block.tsx
│   │   │   ├── message-item.tsx
│   │   │   ├── message-list.tsx
│   │   │   └── chat-panel.tsx
│   │   └── sidebar/
│   │       ├── session-item.tsx
│   │       ├── session-list.tsx
│   │       └── session-sidebar.tsx
│   ├── lib/
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   ├── stream-parser.ts
│   │   ├── use-sse.ts
│   │   ├── agent-client.ts
│   │   ├── session-store.ts
│   │   └── server-agent-state.ts
│   └── styles/
│       └── globals.css
```

---

### Task 1: 项目脚手架

**Files:** Create `packages/web/package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `components.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "rem-agent-web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "rem-agent-core": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next": "^15.0.0",
    "zustand": "^5.0.0",
    "react-virtuoso": "^4.0.0",
    "react-markdown": "^10.0.0",
    "rehype-highlight": "^7.0.0",
    "remark-gfm": "^4.0.0",
    "highlight.js": "^11.0.0",
    "lucide-react": "^0.400.0",
    "tailwind-merge": "^2.6.0",
    "clsx": "^2.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: 创建 next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['rem-agent-core'],
};

export default nextConfig;
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: 创建 postcss.config.mjs**

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 5: 创建 components.json（shadcn/ui 配置）**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib"
  }
}
```

- [ ] **Step 6: 安装依赖并验证 core 构建**

Run: `cd packages/web && pnpm install`

确保 `rem-agent-core` 先构建：
Run: `pnpm --filter rem-agent-core build`

- [ ] **Step 7: Commit**

```bash
git add packages/web/package.json packages/web/next.config.ts packages/web/tsconfig.json packages/web/postcss.config.mjs packages/web/components.json pnpm-lock.yaml
git commit -m "feat(web): scaffold Next.js project"
```

---

### Task 2: 设计 Token 样式 + lib/utils.ts

**Files:** Create `packages/web/src/styles/globals.css`, `packages/web/src/lib/utils.ts`

- [ ] **Step 1: 创建 lib/utils.ts**

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: 创建 styles/globals.css（完整设计 Token）**

```css
@import 'tailwindcss';

@variant dark (&:is(.dark *));

@theme inline {
  --color-bg: #0f1318;
  --color-sb: #151a21;
  --color-card: #1a2129;
  --color-card2: #161c23;
  --color-bd: #232b35;
  --color-bd2: #2a333e;
  --color-tx: #e6ebf1;
  --color-tx2: #9aa7b4;
  --color-tx3: #5d6b7a;
  --color-ac: #b9a9ff;
  --color-ac-ink: #1c1635;
  --color-ac-soft: #2a2350;
  --color-ok: #6ee7b7;
  --color-ok-bg: #10241d;
  --color-err: #fb7185;
  --color-err-bg: #2a1620;
  --color-warn: #fbbf24;
  --color-warn-bg: #2a2310;
  --radius-card: 14px;
  --radius-btn: 9px;
  --radius-chip: 18px;
  --font-mono: 'SF Mono', ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

@layer base {
  body {
    background-color: var(--color-bg);
    color: var(--color-tx);
    font-family: var(--font-sans);
  }

  *:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(185, 169, 255, 0.12);
    border-color: var(--color-ac);
  }

  ::selection {
    background-color: rgba(185, 169, 255, 0.3);
  }
}

@utility scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: var(--color-bd2) transparent;
}
```

- [ ] **Step 3: 验证 Tailwind 构建**

Run: `pnpm --filter rem-agent-web build`

Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/styles/globals.css packages/web/src/lib/utils.ts
git commit -m "feat(web): add design tokens and Tailwind setup"
```

---

### Task 3: lib/types.ts 前端类型定义

**Files:** Create `packages/web/src/lib/types.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
import type { AgentStreamChunk, ToolCallRecord } from 'rem-agent-core';

export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
  pinned?: boolean;
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls: ToolCallRecord[];
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
}

export interface RunResponse {
  sessionId: string;
  streamUrl: string;
}

export interface SSEEvent {
  event?: string;
  data: string;
}

export function isSSETextDelta(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'text-delta' } {
  return c.type === 'text-delta';
}

export function isSSEReasoningDelta(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'reasoning-delta' } {
  return c.type === 'reasoning-delta';
}

export function isSSEReasoningFinish(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'reasoning-finish' } {
  return c.type === 'reasoning-finish';
}

export function isSSEToolCallStart(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'tool-call-start' } {
  return c.type === 'tool-call-start';
}

export function isSSEToolResult(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'tool-result' } {
  return c.type === 'tool-result';
}

export function isSSEFinish(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'finish' } {
  return c.type === 'finish';
}

export function isSSEError(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'error' } {
  return c.type === 'error';
}

export type { AgentStreamChunk, ToolCallRecord };
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/types.ts
git commit -m "feat(web): add frontend type definitions"
```

---

### Task 4: lib/stream-parser.ts SSE 流解析

**Files:** Create `packages/web/src/lib/stream-parser.ts`

- [ ] **Step 1: 创建 stream-parser.ts**

```typescript
import type { SSEEvent, AgentStreamChunk } from './types.js';

export function parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<SSEEvent> {
  const decoder = new TextDecoder();

  return {
    [Symbol.asyncIterator]: async function* () {
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType: string | undefined;
        let dataLines: string[] = [];

        for (const line of lines) {
          if (line === '') {
            if (dataLines.length > 0) {
              yield { event: eventType, data: dataLines.join('\n') };
              eventType = undefined;
              dataLines = [];
            }
            continue;
          }
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          }
        }

        if (done) {
          if (buffer.length > 0) {
            if (buffer.startsWith('data: ')) {
              dataLines.push(buffer.slice(6));
              if (dataLines.length > 0) {
                yield { event: eventType, data: dataLines.join('\n') };
              }
            }
          }
          return;
        }
      }
    },
  };
}

export function parseAgentStreamEvent(event: SSEEvent): AgentStreamChunk {
  return JSON.parse(event.data) as AgentStreamChunk;
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/stream-parser.ts
git commit -m "feat(web): add SSE stream parser"
```

---

### Task 5: lib/use-sse.ts SSE 消费 Hook

**Files:** Create `packages/web/src/lib/use-sse.ts`

- [ ] **Step 1: 创建 use-sse.ts**

```typescript
'use client';

import { useRef, useCallback } from 'react';
import type { AgentStreamChunk } from './types.js';
import { parseSSEStream, parseAgentStreamEvent } from './stream-parser.js';

type ChunkHandler = (chunk: AgentStreamChunk) => void;
type StatusHandler = (status: 'connecting' | 'reconnecting' | 'error' | 'done') => void;

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const connect = useCallback(
    (
      url: string,
      onChunk: ChunkHandler,
      onError?: (err: Error) => void,
      onStatus?: StatusHandler,
    ) => {
      const abort = new AbortController();
      abortRef.current = abort;

      async function start() {
        try {
          onStatus?.('connecting');
          const response = await fetch(url, { signal: abort.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          retryCountRef.current = 0;
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No readable stream');

          for await (const sse of parseSSEStream(reader)) {
            const chunk = parseAgentStreamEvent(sse);
            onChunk(chunk);
            if (chunk.type === 'finish' || chunk.type === 'error') {
              onStatus?.(chunk.type === 'error' ? 'error' : 'done');
              return;
            }
          }
          onStatus?.('done');
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            onStatus?.('reconnecting');
            await new Promise((r) => setTimeout(r, 3000));
            start();
          } else {
            onStatus?.('error');
            onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }

      start();
    },
    [],
  );

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    retryCountRef.current = 0;
  }, []);

  return { connect, disconnect };
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/use-sse.ts
git commit -m "feat(web): add useSSE hook"
```

---

### Task 6: lib/agent-client.ts API 调用封装

**Files:** Create `packages/web/src/lib/agent-client.ts`

- [ ] **Step 1: 创建 agent-client.ts**

```typescript
import type { SessionSummary, RunResponse } from './types.js';

export async function runAgent(sessionId: string, input: string): Promise<RunResponse> {
  const res = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content: input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to run agent: ${res.status} ${text}`);
  }
  return res.json() as Promise<RunResponse>;
}

export async function interruptAgent(sessionId: string): Promise<void> {
  await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, interrupt: true }),
  });
}

export async function listSessions(q?: string): Promise<SessionSummary[]> {
  const params = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await fetch(`/api/sessions${params}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to list sessions: ${res.status} ${text}`);
  }
  return res.json() as Promise<SessionSummary[]>;
}

export async function createSession(): Promise<SessionSummary> {
  const res = await fetch('/api/sessions', { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }
  return res.json() as Promise<SessionSummary>;
}

export async function getSession(sessionId: string): Promise<{ sessionId: string; title?: string; messages: unknown[] }> {
  const res = await fetch(`/api/sessions/${sessionId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get session: ${res.status} ${text}`);
  }
  return res.json();
}

export async function updateSession(sessionId: string, updates: { title?: string; pinned?: boolean }): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update session: ${res.status} ${text}`);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to delete session: ${res.status} ${text}`);
  }
}

export function getStreamUrl(sessionId: string): string {
  return `/api/stream/${sessionId}`;
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/agent-client.ts
git commit -m "feat(web): add agent client API layer"
```

---

### Task 7: lib/server-agent-state.ts 服务端共享状态

**Files:** Create `packages/web/src/lib/server-agent-state.ts`

- [ ] **Step 1: 创建 server-agent-state.ts**

```typescript
import { createAgentFromEnv } from 'rem-agent-core';

type Agent = ReturnType<typeof createAgentFromEnv>;
type RunResult = ReturnType<Agent['run']>;

interface AgentEntry {
  agent: Agent;
}

const agentStore = new Map<string, AgentEntry>();
const activeStreams = new Map<string, { result: RunResult; abort: AbortController }>();

export async function getOrCreateAgent(sessionId: string): Promise<Agent> {
  let entry = agentStore.get(sessionId);
  if (!entry) {
    const agent = createAgentFromEnv({ name: 'Rem Agent', maxTurns: 60 });
    await agent.ready();
    await agent.initialize({ sessionId });
    entry = { agent };
    agentStore.set(sessionId, entry);
  }
  return entry.agent;
}

export function setActiveRun(sessionId: string, result: RunResult, abort: AbortController): void {
  activeStreams.set(sessionId, { result, abort });
}

export function clearActiveRun(sessionId: string): void {
  activeStreams.delete(sessionId);
}

export function getActiveRun(sessionId: string) {
  return activeStreams.get(sessionId) ?? null;
}

export function interruptActiveRun(sessionId: string): boolean {
  const entry = activeStreams.get(sessionId);
  if (entry) {
    entry.abort.abort();
    activeStreams.delete(sessionId);
    return true;
  }
  return false;
}

export async function generateTitle(sessionId: string): Promise<string> {
  const entry = agentStore.get(sessionId);
  if (!entry) return '';
  return entry.agent.generateTitle();
}

export async function listAgentSessions(): Promise<Array<{ sessionId: string; title?: string; updatedAt: number; messageCount: number }>> {
  const firstEntry = agentStore.values().next().value;
  if (!firstEntry) return [];
  return firstEntry.agent.listSessions();
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/server-agent-state.ts
git commit -m "feat(web): add shared server agent state module"
```

---

### Task 8: API Route — POST /api/agent/run（含 interrupt）

**Files:** Create `packages/web/src/app/api/agent/run/route.ts`

- [ ] **Step 1: 创建 route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateAgent, setActiveRun, interruptActiveRun } from '@/lib/server-agent-state';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, content, interrupt } = body as {
      sessionId: string;
      content?: string;
      interrupt?: boolean;
    };

    if (interrupt) {
      const interrupted = interruptActiveRun(sessionId);
      return NextResponse.json({ sessionId, interrupted });
    }

    if (!content || !sessionId) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    const agent = await getOrCreateAgent(sessionId);
    const abort = new AbortController();
    const result = agent.run({ content, timestamp: new Date() });
    setActiveRun(sessionId, result, abort);

    return NextResponse.json({ sessionId, streamUrl: `/api/stream/${sessionId}` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/agent/run/route.ts
git commit -m "feat(web): add POST /api/agent/run route"
```

---

### Task 9: API Route — GET /api/stream/[sessionId]

**Files:** Create `packages/web/src/app/api/stream/[sessionId]/route.ts`

- [ ] **Step 1: 创建 route.ts**

```typescript
import { NextRequest } from 'next/server';
import { getActiveRun, clearActiveRun } from '@/lib/server-agent-state';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const active = getActiveRun(sessionId);
  if (!active) {
    return new Response(JSON.stringify({ error: 'No active stream' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of active.result.stream.fullStream) {
          const line = `event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(line));
          if (chunk.type === 'finish' || chunk.type === 'error') break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        const line = `event: error\ndata: ${JSON.stringify({ type: 'error', error: message })}\n\n`;
        controller.enqueue(encoder.encode(line));
      } finally {
        controller.close();
        clearActiveRun(sessionId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/stream/[sessionId]/route.ts
git commit -m "feat(web): add GET /api/stream/[sessionId] route"
```

---

### Task 10: API Routes — /api/sessions（列表 + 新建）

**Files:** Create `packages/web/src/app/api/sessions/route.ts`

- [ ] **Step 1: 创建 route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateAgent, listAgentSessions } from '@/lib/server-agent-state';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';

    let sessions = await listAgentSessions();
    if (q) {
      const lower = q.toLowerCase();
      sessions = sessions.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
    }

    return NextResponse.json(sessions);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const sessionId = crypto.randomUUID();
    const agent = await getOrCreateAgent(sessionId);

    const title = 'New Chat';
    await agent.initialize({ sessionId });

    return NextResponse.json({
      sessionId,
      title,
      updatedAt: Date.now(),
      messageCount: 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/sessions/route.ts
git commit -m "feat(web): add sessions list and create routes"
```

---

### Task 11: API Routes — /api/sessions/[id]（详情 + 更新 + 删除）

**Files:** Create `packages/web/src/app/api/sessions/[id]/route.ts`

- [ ] **Step 1: 创建 route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateAgent } from '@/lib/server-agent-state';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = await getOrCreateAgent(id);

    return NextResponse.json({
      sessionId: id,
      title: agent.name,
      messages: agent.conversation.map((msg, idx) => ({
        id: `msg-${idx}`,
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        status: 'done' as const,
        toolCalls: [],
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, pinned } = body as { title?: string; pinned?: boolean };

    // CoreAgent 暂不支持直接改 title/pinned，用内存存储
    if (title) {
      titles.set(id, title);
    }
    if (pinned !== undefined) {
      pins.set(id, pinned);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

const titles = new Map<string, string>();
export const pins = new Map<string, boolean>();

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    titles.delete(id);
    pins.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/sessions/[id]/route.ts
git commit -m "feat(web): add session detail/update/delete routes"
```

---

### Task 12: lib/session-store.ts 会话状态管理

**Files:** Create `packages/web/src/lib/session-store.ts`

- [ ] **Step 1: 创建 session-store.ts**

```typescript
'use client';

import { create } from 'zustand';
import type { SessionSummary, UIMessage, AgentStreamChunk } from './types.js';
import {
  isSSETextDelta, isSSEReasoningDelta, isSSEToolCallStart,
  isSSEToolResult, isSSEFinish, isSSEError,
} from './types.js';
import {
  listSessions, createSession, getSession, updateSession,
  deleteSession, runAgent, interruptAgent,
} from './agent-client.js';
import type { ToolCallRecord } from 'rem-agent-core';

let assistantMessageId = '';

export const useSessionStore = create<{
  sessions: SessionSummary[];
  currentSessionId: string | null;
  searchQuery: string;
  messages: UIMessage[];
  streaming: boolean;
  error: string | null;
  serverError: boolean;
  reconnecting: boolean;

  init: () => Promise<void>;
  createSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<{ streamUrl: string } | undefined>;
  interrupt: () => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setSearchQuery: (q: string) => void;

  onChunk: (chunk: AgentStreamChunk) => void;
  setReconnecting: (v: boolean) => void;
  clearError: () => void;
}>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  searchQuery: '',
  messages: [],
  streaming: false,
  error: null,
  serverError: false,
  reconnecting: false,

  init: async () => {
    try {
      const sessions = await listSessions();
      set({ sessions });
    } catch {
      set({ serverError: true });
    }
  },

  createSession: async () => {
    try {
      const session = await createSession();
      set((s) => ({
        sessions: [session, ...s.sessions],
        currentSessionId: session.sessionId,
        messages: [],
        error: null,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '创建会话失败' });
    }
  },

  selectSession: async (id: string) => {
    if (get().streaming) {
      try { await interruptAgent(get().currentSessionId!); } catch { /* ignore */ }
    }
    try {
      const detail = await getSession(id);
      set({
        currentSessionId: id,
        messages: (detail.messages ?? []) as UIMessage[],
        streaming: false,
        error: null,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载会话失败' });
    }
  },

  sendMessage: async (text: string) => {
    const { currentSessionId, messages } = get();
    if (!currentSessionId || get().streaming) return;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      toolCalls: [],
      status: 'done',
    };
    const assistantMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      status: 'pending',
    };
    assistantMessageId = assistantMsg.id;

    // ⚠️ 先设置 streaming: false（仅 UI 展示 pending），等 POST 成功后再设 streaming: true（触发 SSE 连接）
    set({ messages: [...messages, userMsg, assistantMsg], error: null });

    try {
      const result = await runAgent(currentSessionId, text);
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, status: 'streaming' as const } : m,
        ),
        streaming: true,
      }));
      return result;
    } catch (err) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, status: 'error' as const, error: err instanceof Error ? err.message : '发送失败' }
            : m,
        ),
      }));
    }
  },

  onChunk: (chunk: AgentStreamChunk) => {
    if (isSSETextDelta(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, content: m.content + chunk.text } : m,
        ),
      }));
    } else if (isSSEReasoningDelta(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, reasoning: (m.reasoning ?? '') + chunk.text } : m,
        ),
      }));
    } else if (isSSEToolCallStart(chunk)) {
      const newTool: ToolCallRecord = {
        id: chunk.toolCallId,
        name: chunk.toolName,
        arguments: {} as Record<string, unknown>,
        durationMs: 0,
        timestamp: new Date(),
      };
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, toolCalls: [...m.toolCalls, newTool] } : m,
        ),
      }));
    } else if (isSSEToolResult(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                toolCalls: m.toolCalls.map((tc) =>
                  tc.id === chunk.toolCallId
                    ? {
                        ...tc,
                        result: {
                          success: !chunk.error,
                          output: chunk.output,
                          error: chunk.error,
                          durationMs: tc.durationMs,
                        },
                      }
                    : tc,
                ),
              }
            : m,
        ),
      }));
    } else if (isSSEFinish(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId ? { ...m, status: 'done' as const } : m,
        ),
        streaming: false,
      }));
    } else if (isSSEError(chunk)) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantMessageId
            ? { ...m, status: 'error' as const, error: String(chunk.error) }
            : m,
        ),
        streaming: false,
      }));
    }
  },

  setReconnecting: (v: boolean) => set({ reconnecting: v }),
  clearError: () => set({ error: null }),

  interrupt: async () => {
    const { currentSessionId } = get();
    if (!currentSessionId) return;
    try { await interruptAgent(currentSessionId); } catch { /* ignore */ }
    set({ streaming: false });
  },

  renameSession: async (id: string, title: string) => {
    try {
      await updateSession(id, { title });
      set((s) => ({
        sessions: s.sessions.map((ses) => (ses.sessionId === id ? { ...ses, title } : ses)),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '重命名失败' });
    }
  },

  deleteSession: async (id: string) => {
    try {
      await deleteSession(id);
      set((s) => {
        const remaining = s.sessions.filter((ses) => ses.sessionId !== id);
        const next = remaining[0]?.sessionId ?? null;
        return {
          sessions: remaining,
          currentSessionId: s.currentSessionId === id ? next : s.currentSessionId,
          messages: s.currentSessionId === id ? [] : s.messages,
        };
      });
      if (!get().currentSessionId) {
        get().createSession();
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '删除失败' });
    }
  },

  togglePin: async (id: string) => {
    const session = get().sessions.find((s) => s.sessionId === id);
    if (!session) return;
    const pinned = !session.pinned;
    try {
      await updateSession(id, { pinned });
      set((s) => ({
        sessions: s.sessions.map((ses) => (ses.sessionId === id ? { ...ses, pinned } : ses)),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '操作失败' });
    }
  },

  setSearchQuery: (q: string) => {
    set({ searchQuery: q });
    listSessions(q).then((sessions) => set({ sessions })).catch(() => {});
  },
}));
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/session-store.ts
git commit -m "feat(web): add Zustand session store"
```

---

### Task 13: UI — InputBox 输入框组件

**Files:** Create `packages/web/src/components/chat/input-box.tsx`

- [ ] **Step 1: 创建 input-box.tsx**

```typescript
'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { useSessionStore } from '@/lib/session-store';

export function InputBox() {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streaming = useSessionStore((s) => s.streaming);
  const serverError = useSessionStore((s) => s.serverError);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const interrupt = useSessionStore((s) => s.interrupt);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await sendMessage(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [text]);

  return (
    <div className="border-t border-bd px-4 py-3 bg-bg">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={serverError ? '服务异常，请稍后重试' : '输入消息...'}
          rows={1}
          disabled={streaming || serverError}
          className="flex-1 resize-none rounded-btn bg-card border border-bd2 text-tx placeholder-tx3 px-4 py-2.5 text-sm outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ maxHeight: '160px' }}
        />
        {streaming ? (
          <button
            onClick={interrupt}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-btn bg-err text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Square size={14} fill="currentColor" />
            中断
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || serverError}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-btn bg-ac text-ac-ink text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            发送
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/input-box.tsx
git commit -m "feat(web): add InputBox component"
```

---

### Task 14: UI — ThinkingBar 状态指示条

**Files:** Create `packages/web/src/components/chat/thinking-bar.tsx`

- [ ] **Step 1: 创建 thinking-bar.tsx**

```typescript
'use client';

import { Loader2 } from 'lucide-react';

export function ThinkingBar() {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-tx3 text-sm">
      <Loader2 size={14} className="animate-spin" />
      <span>Thinking</span>
      <span className="inline-flex gap-0.5">
        <span className="w-1 h-1 rounded-full bg-tx3 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1 h-1 rounded-full bg-tx3 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1 h-1 rounded-full bg-tx3 animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/thinking-bar.tsx
git commit -m "feat(web): add ThinkingBar component"
```

---

### Task 15: UI — ReasoningBlock 推理折叠块

**Files:** Create `packages/web/src/components/chat/reasoning-block.tsx`

- [ ] **Step 1: 创建 reasoning-block.tsx**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReasoningBlockProps {
  text: string;
  isStreaming: boolean;
}

export function ReasoningBlock({ text, isStreaming }: ReasoningBlockProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isStreaming && text.length > 0) {
      setOpen(true);
    }
  }, [isStreaming, text]);

  if (!text && !isStreaming) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-chip bg-ac-soft/50 text-ac text-xs font-medium hover:bg-ac-soft transition-colors w-full text-left"
      >
        <ChevronRight
          size={12}
          className={cn('transition-transform flex-shrink-0', open && 'rotate-90')}
        />
        <Sparkles size={12} className="flex-shrink-0" />
        <span>Thinking</span>
        {isStreaming && <Loader2 size={10} className="animate-spin ml-auto" />}
      </button>

      {open && (
        <div className="mt-1.5 mx-2 px-3 py-2 rounded-card bg-card2 border border-bd text-tx2 text-xs italic leading-relaxed max-h-48 overflow-y-auto">
          {text || (isStreaming ? '...' : '')}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/reasoning-block.tsx
git commit -m "feat(web): add ReasoningBlock component"
```

---

### Task 16: UI — ToolCallBlock 工具调用折叠块

**Files:** Create `packages/web/src/components/chat/tool-call-block.tsx`

- [ ] **Step 1: 创建 tool-call-block.tsx**

```typescript
'use client';

import { useState } from 'react';
import { ChevronRight, Wrench, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCallRecord } from 'rem-agent-core';

interface ToolCallBlockProps {
  tool: ToolCallRecord;
}

export function ToolCallBlock({ tool }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const hasResult = !!tool.result;
  const isError = !!tool.result?.error;
  const isExecuting = !hasResult;

  const statusIcon = isExecuting
    ? <Loader2 size={14} className="animate-spin text-tx3" />
    : isError
      ? <XCircle size={14} className="text-err" />
      : <CheckCircle2 size={14} className="text-ok" />;

  const statusText = isExecuting ? '执行中...' : isError ? '执行失败' : tool.result?.output?.slice(0, 60) ?? '完成';

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-chip text-xs font-medium transition-colors w-full text-left',
          isError ? 'bg-err-bg text-err' : isExecuting ? 'bg-bd text-tx3' : 'bg-ok-bg text-ok',
        )}
      >
        <ChevronRight
          size={12}
          className={cn('transition-transform flex-shrink-0', open && 'rotate-90')}
        />
        <Wrench size={12} className="flex-shrink-0" />
        <span className="font-mono truncate">{tool.name}</span>
        {statusIcon}
        <span className="truncate text-tx3 flex-1">{statusText}</span>
      </button>

      {open && (
        <div className="mt-1.5 mx-2 px-3 py-2 rounded-card bg-card2 border border-bd text-xs">
          <div className="text-tx3 mb-1 font-medium">入参</div>
          <pre className="text-tx2 font-mono text-xs overflow-x-auto max-h-24 whitespace-pre-wrap">
            {JSON.stringify(tool.arguments, null, 2) || '{}'}
          </pre>
          {hasResult && (
            <>
              <div className="text-tx3 mt-2 mb-1 font-medium">
                {isError ? '错误' : '出参'}
              </div>
              <pre
                className={cn(
                  'font-mono text-xs overflow-x-auto max-h-32 whitespace-pre-wrap',
                  isError ? 'text-err' : 'text-tx2',
                )}
              >
                {isError ? tool.result!.error : tool.result!.output}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/tool-call-block.tsx
git commit -m "feat(web): add ToolCallBlock component"
```

---

### Task 17: UI — MessageItem 单条消息

**Files:** Create `packages/web/src/components/chat/message-item.tsx`

- [ ] **Step 1: 创建 message-item.tsx**

```typescript
'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';
import type { UIMessage } from '@/lib/types';
import { ReasoningBlock } from './reasoning-block';
import { ToolCallBlock } from './tool-call-block';
import { ThinkingBar } from './thinking-bar';

interface MessageItemProps {
  message: UIMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';

  const markdownComponents = useMemo(
    () => ({
      pre({ children, ...props }: Record<string, unknown>) {
        return (
          <pre
            className="bg-bd rounded-btn p-3 overflow-x-auto max-h-[140px] text-xs font-mono my-2 border border-bd2"
            {...props}
          >
            {children as React.ReactNode}
          </pre>
        );
      },
      code({ className, children, ...props }: { className?: string; children?: React.ReactNode } & Record<string, unknown>) {
        const isInline = !className;
        if (isInline) {
          return (
            <code className="bg-bd px-1.5 py-0.5 rounded text-ac text-xs font-mono" {...props}>
              {children}
            </code>
          );
        }
        return (
          <code className={cn('text-xs font-mono', className)} {...props}>
            {children}
          </code>
        );
      },
      table({ children, ...props }: Record<string, unknown>) {
        return (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full border-collapse border border-bd2 text-xs" {...props}>
              {children as React.ReactNode}
            </table>
          </div>
        );
      },
      th({ children, ...props }: Record<string, unknown>) {
        return (
          <th className="border border-bd2 px-3 py-1.5 bg-bd text-tx2 font-medium text-left" {...props}>
            {children as React.ReactNode}
          </th>
        );
      },
      td({ children, ...props }: Record<string, unknown>) {
        return (
          <td className="border border-bd2 px-3 py-1.5 text-tx" {...props}>
            {children as React.ReactNode}
          </td>
        );
      },
    }),
    [],
  );

  if (isUser) {
    return (
      <div className="flex justify-end px-4 py-3">
        <div className="max-w-[80%] rounded-card rounded-br-sm bg-ac text-ac-ink px-4 py-2.5 text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  const showThinkingBar = message.status === 'pending' || (message.status === 'streaming' && !message.content && !message.reasoning);

  return (
    <div className="px-4 py-3">
      <div
        className={cn(
          'max-w-[85%] rounded-card rounded-bl-sm bg-card border border-bd px-4 py-2.5 text-sm leading-relaxed',
          message.status === 'error' && 'border-err/50',
        )}
      >
        {showThinkingBar && <ThinkingBar />}

        <ReasoningBlock
          text={message.reasoning ?? ''}
          isStreaming={message.status === 'streaming'}
        />

        {message.toolCalls.map((tc) => (
          <ToolCallBlock key={tc.id} tool={tc} />
        ))}

        {message.content && (
          <div className="prose prose-invert prose-sm max-w-none text-tx">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {message.status === 'error' && message.error && (
          <div className="mt-2 px-3 py-2 rounded-btn bg-err-bg text-err text-xs border border-err/30">
            {message.error}
            <button
              className="ml-2 underline hover:opacity-80"
              onClick={() => {
                // Retry: re-send last user message
                const store = (await import('@/lib/session-store')).useSessionStore;
                const msgs = store.getState().messages;
                const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
                if (lastUser) store.getState().sendMessage(lastUser.content);
              }}
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

Wait — the retry button uses dynamic import, which is valid but the inline `await` won't work in JSX. Let me remove retry for now (YAGNI — spec says no "消息重新生成").

- [ ] **Step 1 (修订): 创建 message-item.tsx（无重试按钮）**

```typescript
'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';
import type { UIMessage } from '@/lib/types';
import { ReasoningBlock } from './reasoning-block';
import { ToolCallBlock } from './tool-call-block';
import { ThinkingBar } from './thinking-bar';

interface MessageItemProps {
  message: UIMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';

  const markdownComponents = useMemo(
    () => ({
      pre({ children, ...props }: Record<string, unknown>) {
        return (
          <pre className="bg-bd rounded-btn p-3 overflow-x-auto max-h-[140px] text-xs font-mono my-2 border border-bd2" {...props}>
            {children as React.ReactNode}
          </pre>
        );
      },
      code({ className, children, ...props }: { className?: string; children?: React.ReactNode } & Record<string, unknown>) {
        const isInline = !className;
        if (isInline) {
          return <code className="bg-bd px-1.5 py-0.5 rounded text-ac text-xs font-mono" {...props}>{children}</code>;
        }
        return <code className={cn('text-xs font-mono', className)} {...props}>{children}</code>;
      },
      table({ children, ...props }: Record<string, unknown>) {
        return (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full border-collapse border border-bd2 text-xs" {...props}>{children as React.ReactNode}</table>
          </div>
        );
      },
      th({ children, ...props }: Record<string, unknown>) {
        return <th className="border border-bd2 px-3 py-1.5 bg-bd text-tx2 font-medium text-left" {...props}>{children as React.ReactNode}</th>;
      },
      td({ children, ...props }: Record<string, unknown>) {
        return <td className="border border-bd2 px-3 py-1.5 text-tx" {...props}>{children as React.ReactNode}</td>;
      },
    }),
    [],
  );

  if (isUser) {
    return (
      <div className="flex justify-end px-4 py-3">
        <div className="max-w-[80%] rounded-card rounded-br-sm bg-ac text-ac-ink px-4 py-2.5 text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  const showThinkingBar = message.status === 'pending' ||
    (message.status === 'streaming' && !message.content && !message.reasoning);

  return (
    <div className="px-4 py-3">
      <div className={cn(
        'max-w-[85%] rounded-card rounded-bl-sm bg-card border border-bd px-4 py-2.5 text-sm leading-relaxed',
        message.status === 'error' && 'border-err/50',
      )}>
        {showThinkingBar && <ThinkingBar />}
        <ReasoningBlock text={message.reasoning ?? ''} isStreaming={message.status === 'streaming'} />
        {message.toolCalls.map((tc) => <ToolCallBlock key={tc.id} tool={tc} />)}
        {message.content && (
          <div className="prose prose-invert prose-sm max-w-none text-tx">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {message.status === 'error' && message.error && (
          <div className="mt-2 px-3 py-2 rounded-btn bg-err-bg text-err text-xs border border-err/30">{message.error}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/message-item.tsx
git commit -m "feat(web): add MessageItem component"
```

---

### Task 18: UI — MessageList 消息列表（虚拟滚动）

**Files:** Create `packages/web/src/components/chat/message-list.tsx`

- [ ] **Step 1: 创建 message-list.tsx**

```typescript
'use client';

import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useRef, useEffect } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { MessageItem } from './message-item';
import type { UIMessage } from '@/lib/types';

export function MessageList() {
  const messages = useSessionStore((s) => s.messages);
  const virtRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    if (messages.length > 0 && virtRef.current) {
      virtRef.current.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
    }
  }, [messages.length]);

  useEffect(() => {
    // Auto-scroll on content/text changes while streaming
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.status === 'streaming') {
      virtRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'auto' });
    }
  }, [messages.map((m) => m.content).join(''), messages.map((m) => m.reasoning).join('')]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-tx3 text-sm gap-3">
        <div className="w-12 h-12 rounded-full bg-ac-soft flex items-center justify-center text-ac text-lg font-medium">
          R
        </div>
        <span>你好，请问有什么可以帮助你的？</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0">
      <Virtuoso
        ref={virtRef}
        data={messages}
        itemContent={(_index: number, msg: UIMessage) => <MessageItem message={msg} />}
        followOutput="smooth"
        className="scrollbar-thin"
      />
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/message-list.tsx
git commit -m "feat(web): add MessageList component"
```

---

### Task 19: UI — SessionItem + SessionList + SessionSidebar 侧边栏

**Files:** Create `packages/web/src/components/sidebar/session-item.tsx`, `session-list.tsx`, `session-sidebar.tsx`

- [ ] **Step 1: 创建 session-item.tsx**

```typescript
'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { MoreHorizontal, Pin, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionSummary } from '@/lib/types';
import { useSessionStore } from '@/lib/session-store';

interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
}

export function SessionItem({ session, isActive }: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectSession = useSessionStore((s) => s.selectSession);
  const renameSession = useSessionStore((s) => s.renameSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const togglePin = useSessionStore((s) => s.togglePin);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleRename = () => {
    const trimmed = editTitle.trim();
    if (trimmed) {
      renameSession(session.sessionId, trimmed);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleRename();
    if (e.key === 'Escape') setEditing(false);
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-2 cursor-pointer text-sm rounded-btn mx-2 transition-colors',
        isActive ? 'bg-card border-l-2 border-ac' : 'hover:bg-card/50',
      )}
      onClick={() => selectSession(session.sessionId)}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-bd border border-bd2 rounded px-2 py-0.5 text-xs text-tx outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate text-tx2 group-hover:text-tx transition-colors">
          {session.title ?? 'New Chat'}
        </span>
      )}

      {session.pinned && <Pin size={10} className="text-ac flex-shrink-0" />}

      {!editing && (
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bd transition-all"
          >
            <MoreHorizontal size={14} className="text-tx3" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-card border border-bd rounded-btn shadow-lg py-1">
              <button
                onClick={(e) => { e.stopPropagation(); togglePin(session.sessionId); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tx2 hover:bg-bd hover:text-tx transition-colors"
              >
                <Pin size={12} /> {session.pinned ? '取消置顶' : '置顶'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditing(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tx2 hover:bg-bd hover:text-tx transition-colors"
              >
                <Pencil size={12} /> 重命名
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-err hover:bg-err-bg transition-colors"
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(false)}>
          <div className="bg-card border border-bd rounded-card p-4 max-w-xs mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-tx mb-1">确定要删除这个会话吗？</p>
            <p className="text-xs text-tx3 mb-3">此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-btn text-xs text-tx2 hover:bg-bd transition-colors">取消</button>
              <button onClick={() => { deleteSession(session.sessionId); setConfirmDelete(false); }} className="px-3 py-1.5 rounded-btn text-xs bg-err text-white hover:opacity-90 transition-opacity">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建 session-list.tsx**

```typescript
'use client';

import { useSessionStore } from '@/lib/session-store';
import { SessionItem } from './session-item';

export function SessionList() {
  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  // Sort: pinned first by pin time desc, then by updatedAt desc
  const sorted = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-8 text-xs text-tx3 text-center">暂无对话</div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
      {sorted.map((s) => (
        <SessionItem key={s.sessionId} session={s} isActive={s.sessionId === currentSessionId} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 创建 session-sidebar.tsx**

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Menu, X } from 'lucide-react';
import { useSessionStore } from '@/lib/session-store';
import { SessionList } from './session-list';

export function SessionSidebar() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const createSession = useSessionStore((s) => s.createSession);
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search, setSearchQuery]);

  const sidebar = (
    <div className="flex flex-col h-full bg-sb border-r border-bd w-64 flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-bd">
        <button onClick={() => setOpen(false)} className="lg:hidden p-1 rounded hover:bg-bd">
          <X size={16} className="text-tx2" />
        </button>
        <span className="text-sm font-semibold text-tx">Rem Agent</span>
      </div>

      <div className="px-3 py-2">
        <button
          onClick={() => { createSession(); setOpen(false); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-btn bg-ac text-ac-ink text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> 新对话
        </button>
      </div>

      <div className="px-3 py-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-btn bg-card border border-bd2">
          <Search size={14} className="text-tx3 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索对话..."
            className="flex-1 bg-transparent text-xs text-tx placeholder-tx3 outline-none"
          />
        </div>
      </div>

      <SessionList />
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block h-full">{sidebar}</div>

      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 p-2 rounded-btn bg-sb border border-bd text-tx2 hover:text-tx"
      >
        <Menu size={18} />
      </button>

      {/* Mobile drawer */}
      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} />
          <div className="lg:hidden fixed inset-y-0 left-0 z-50">{sidebar}</div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/sidebar/session-item.tsx packages/web/src/components/sidebar/session-list.tsx packages/web/src/components/sidebar/session-sidebar.tsx
git commit -m "feat(web): add session sidebar components"
```

---

### Task 20: UI — ChatPanel 聊天主容器

**Files:** Create `packages/web/src/components/chat/chat-panel.tsx`

- [ ] **Step 1: 创建 chat-panel.tsx**

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { MessageList } from './message-list';
import { InputBox } from './input-box';
import { useSessionStore } from '@/lib/session-store';
import { useSSE } from '@/lib/use-sse';
import { getStreamUrl } from '@/lib/agent-client';

export function ChatPanel() {
  const streaming = useSessionStore((s) => s.streaming);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const onChunk = useSessionStore((s) => s.onChunk);
  const setReconnecting = useSessionStore((s) => s.setReconnecting);
  const { connect, disconnect } = useSSE();
  const connectCalledRef = useRef(false);

  useEffect(() => {
    if (!streaming || !currentSessionId) return;

    const streamUrl = getStreamUrl(currentSessionId);
    connect(
      streamUrl,
      (chunk) => onChunk(chunk),
      (err) => {
        console.error('SSE error:', err);
        const store = useSessionStore.getState();
        store.onChunk({ type: 'error', error: err });
      },
      (status) => {
        setReconnecting(status === 'reconnecting');
      },
    );

    return () => disconnect();
  }, [streaming, currentSessionId, connect, disconnect, onChunk, setReconnecting]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">
          {currentSessionId ? 'Chat' : 'Rem Agent'}
        </span>
        {useSessionStore.getState().reconnecting && (
          <span className="text-xs text-warn bg-warn-bg px-2 py-0.5 rounded-chip animate-pulse">
            正在重连...
          </span>
        )}
        {useSessionStore.getState().serverError && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">
            服务异常
          </span>
        )}
      </header>

      <MessageList />
      <InputBox sendMessage={sendMessage} />
    </div>
  );
}
```

Wait — `useSessionStore.getState()` is not reactive. The header should subscribe to state changes. Let me fix it:

- [ ] **Step 1 (修订): 创建 chat-panel.tsx**

```typescript
'use client';

import { useSessionStore } from '@/lib/session-store';
import { useEffect } from 'react';
import { MessageList } from './message-list';
import { InputBox } from './input-box';
import { useSSE } from '@/lib/use-sse';
import { getStreamUrl } from '@/lib/agent-client';

export function ChatPanel() {
  const streaming = useSessionStore((s) => s.streaming);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const reconnecting = useSessionStore((s) => s.reconnecting);
  const serverError = useSessionStore((s) => s.serverError);
  const onChunk = useSessionStore((s) => s.onChunk);
  const setReconnecting = useSessionStore((s) => s.setReconnecting);
  const { connect, disconnect } = useSSE();

  useEffect(() => {
    if (!streaming || !currentSessionId) return;

    const streamUrl = getStreamUrl(currentSessionId);
    connect(
      streamUrl,
      (chunk) => onChunk(chunk),
      (err) => {
        console.error('SSE error:', err);
        onChunk({ type: 'error', error: err });
      },
      (status) => {
        setReconnecting(status === 'reconnecting');
      },
    );

    return () => disconnect();
  }, [streaming, currentSessionId, connect, disconnect, onChunk, setReconnecting]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
        {reconnecting && (
          <span className="text-xs text-warn bg-warn-bg px-2 py-0.5 rounded-chip animate-pulse">正在重连...</span>
        )}
        {serverError && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">服务异常</span>
        )}
      </header>
      <MessageList />
      <InputBox />
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/chat-panel.tsx
git commit -m "feat(web): add ChatPanel component"
```

---

### Task 21: app/layout.tsx + app/page.tsx 页面集成

**Files:** Create `packages/web/src/app/layout.tsx`, `packages/web/src/app/page.tsx`

- [ ] **Step 1: 创建 layout.tsx**

```typescript
import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Rem Agent',
  description: 'Rem Agent Chat UI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="h-screen overflow-hidden antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: 创建 page.tsx**

```typescript
'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';

export default function Home() {
  const init = useSessionStore((s) => s.init);

  useEffect(() => {
    init().then(() => {
      const { sessions, currentSessionId, createSession } = useSessionStore.getState();
      if (!currentSessionId) {
        createSession();
      }
    });
  }, [init]);

  return (
    <div className="flex h-full">
      <SessionSidebar />
      <ChatPanel />
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/layout.tsx packages/web/src/app/page.tsx
git commit -m "feat(web): integrate Layout and Chat page"
```

---

### Task 22: highlight.js 主题样式 + 空状态 shortcut chips

**Files:** Modify `packages/web/src/styles/globals.css`, `packages/web/src/components/chat/message-list.tsx`

- [ ] **Step 1: globals.css 追加 highlight.js 深色主题覆盖**

```css
/* highlight.js theme override — dark theme compatible with our palette */
@layer base {
  .hljs { background: var(--color-card2); color: var(--color-tx2); }
  .hljs-keyword { color: #c792ea; }
  .hljs-string { color: var(--color-ok); }
  .hljs-number { color: #f78c6c; }
  .hljs-comment { color: var(--color-tx3); font-style: italic; }
  .hljs-function { color: #82aaff; }
  .hljs-title { color: #82aaff; }
  .hljs-params { color: var(--color-tx); }
  .hljs-built_in { color: var(--color-ac); }
  .hljs-type { color: #ffcb6b; }
  .hljs-literal { color: #f78c6c; }
  .hljs-meta { color: var(--color-ac); }
  .hljs-attr { color: var(--color-ac); }
  .hljs-variable { color: var(--color-tx); }
}
```

- [ ] **Step 2: MessageList 空状态添加快捷 chip**

更新 `message-list.tsx` 的空状态部分：

```typescript
// 在空状态 div 中添加：
<div className="flex gap-2 flex-wrap justify-center max-w-md">
  {['帮我写段代码', '解释一个概念', '帮我分析数据'].map((hint) => (
    <button
      key={hint}
      onClick={() => useSessionStore.getState().sendMessage(hint)}
      className="px-3 py-1.5 rounded-chip bg-card border border-bd2 text-xs text-tx2 hover:text-tx hover:border-ac/50 transition-colors"
    >
      {hint}
    </button>
  ))}
</div>
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/styles/globals.css packages/web/src/components/chat/message-list.tsx
git commit -m "feat(web): add highlight.js theme and message hints"
```

---

### Task 23: 集成验证

- [ ] **Step 1: 构建 core（确保最新）**

Run: `pnpm --filter rem-agent-core build`
Expected: 构建成功。

- [ ] **Step 2: 全量类型检查**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: 无错误。

- [ ] **Step 3: 构建 web**

Run: `pnpm --filter rem-agent-web build`
Expected: 构建成功，无错误。

- [ ] **Step 4: 启动开发服务器验证**

Run: `pnpm --filter rem-agent-web dev`

打开 `http://localhost:3000`，验证：
- 页面加载无白屏
- 侧边栏可见、搜索框可用
- 点击 "+ 新对话" 创建新会话
- 发送消息（需配置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY 环境变量）
- 流式消息逐字出现
- 推理块折叠/展开
- 工具调用块折叠/展开
- 会话列表正常显示
- 重命名、删除、置顶功能正常

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(web): final integration and verification"
```
