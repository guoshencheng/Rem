# 服务端自驱动 Run 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `AgentService.run()` 的输出流消费从"客户端连接反向拉动"改为"服务端后台自驱动"，使刷新/断开不再中断 agent 广播与续接。

**Architecture:** `run()` 改为返回 `Promise<void>`：注册 runRegistry、publish session-start、启动 core run，然后 fire-and-forget 一个后台 `drive()` 消费 core fullStream（更新 snapshot + 广播 bus），立即返回。`/api/agent/run` 变命令式返回 JSON；web UI 继续只靠 `/api/agent/stream`（bus）。tui 做最小编译修复（暂不迁 bus）。core 不动。

**Tech Stack:** TypeScript, Node.js, vitest, Next.js/React

**注意：** vitest 用 esbuild 逐文件转译、忽略跨文件类型错误，因此单文件测试可在整体 typecheck 尚未全绿时通过。全仓 typecheck 放到最后一个 task 统一验证。

---

## 文件结构

```
packages/bridge/src/
├── agent.ts                    # run() → void + 新增 drive()
├── agent-service.interface.ts  # run 返回类型 → Promise<void>
└── agent-remote-service.ts     # run() → void（移除 SSE 解析）

packages/web/src/
├── app/api/agent/run/route.ts  # 返回 JSON，不再 createSSEResponse
└── lib/use-agent-bus.ts        # send() 去掉空消费

packages/tui/src/
└── app.ts                      # 最小编译修复（不消费 run 返回值）

tests:
packages/bridge/tests/
├── agent-service-run.test.ts        # 新增：run/drive 行为
├── agent-service-approval.test.ts   # 改写：订阅 bus
└── client.test.ts                   # 改：run 断言为 void
```

---

## Task 1: bridge — `run()` 改 void + 后台 `drive()`

**Files:**
- Modify: `packages/bridge/src/agent-service.interface.ts`
- Modify: `packages/bridge/src/agent.ts`
- Test: `packages/bridge/tests/agent-service-run.test.ts` (create)

- [ ] **Step 1: 写失败测试**

创建 `packages/bridge/tests/agent-service-run.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';
import { bus } from '../src/broadcast-bus.js';
import { runRegistry } from '../src/run-registry.js';
import {
  FileSessionProvider,
  createProviderManager,
  DefaultConfigProvider,
  registerProvider,
  clearProviders,
} from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';
import type { BusEvent } from '../src/types.js';

describe('AgentService.run background driver', () => {
  let dir: string;
  let pm: ProviderManager;
  let service: AgentService;

  beforeEach(async () => {
    clearProviders();
    dir = await mkdtemp(join(tmpdir(), 'agent-service-run-test-'));

    registerProvider('mock-run', {
      resolveConfig() {
        return { provider: 'mock-run', model: 'mock-model', apiKey: 'fake-key' };
      },
      async generate() {
        return { text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      },
      async *stream() {
        yield { type: 'text' as const, text: 'Hello' };
        yield { type: 'usage' as const, inputTokens: 3, outputTokens: 3, totalTokens: 6 };
      },
    });

    const sessionProvider = new FileSessionProvider(dir);
    const configProvider = new DefaultConfigProvider({
      overrides: {
        name: 'RunTestAgent',
        model: { provider: 'mock-run', model: 'mock-model' },
        workspaceRoot: dir,
      },
    });
    await configProvider.init();
    pm = await createProviderManager({ sessionProvider, configProvider });
    service = new AgentService(pm);
  });

  afterEach(async () => {
    for (let i = 0; i < 5; i++) {
      try { await rm(dir, { recursive: true, force: true }); break; }
      catch { await new Promise((r) => setTimeout(r, 50)); }
    }
  });

  function collectBus(sessionId: string): { events: BusEvent[]; stop: () => void } {
    const events: BusEvent[] = [];
    const unsub = bus.subscribe((e) => {
      if (e.sessionId === sessionId) events.push(e);
    });
    return { events, stop: unsub };
  }

  it('run() resolves immediately and registers the run', async () => {
    const summary = await service.createSession();
    const p = service.run(summary.sessionId, 'hi');
    // run must resolve to void quickly, not block on full stream consumption
    await expect(p).resolves.toBeUndefined();
  });

  it('driver broadcasts chunks to the bus without any run-return consumption', async () => {
    const summary = await service.createSession();
    const { events, stop } = collectBus(summary.sessionId);

    await service.run(summary.sessionId, 'hi');

    // wait for background driver to finish
    await new Promise((r) => setTimeout(r, 300));
    stop();

    const types = events.map((e) => e.type);
    expect(types).toContain('session-start');
    expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'message-start')).toBe(true);
    expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'finish')).toBe(true);
    expect(types).toContain('session-end');
    // driver cleaned up
    expect(runRegistry.has(summary.sessionId)).toBe(false);
  });

  it('rejects concurrent run for the same session with 409', async () => {
    const summary = await service.createSession();
    // hold a run by registering manually
    const ac = new AbortController();
    runRegistry.register(summary.sessionId, ac);
    await expect(service.run(summary.sessionId, 'hi')).rejects.toThrow(/already running/);
    runRegistry.remove(summary.sessionId);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/bridge/tests/agent-service-run.test.ts`
Expected: FAIL —目前 `run()` 返回 AsyncIterable 且不后台驱动（`resolves.toBeUndefined` 失败，或广播依赖消费而无事件）。

- [ ] **Step 3: 改接口返回类型**

`packages/bridge/src/agent-service.interface.ts`，把 run 签名改为：

```typescript
  run(sessionId: string, input: string): Promise<void>;
```

（其余方法不变。若该文件顶部 import 了 `AgentStreamChunk` 且此后未使用，删除该 import。）

- [ ] **Step 4: 重构 `AgentService.run` + 新增 `drive`**

在 `packages/bridge/src/agent.ts` 中，把 `run()`（当前 35-119 行）整体替换为下面的 `run()` + 新增私有 `drive()`：

```typescript
  async run(sessionId: string, input: string): Promise<void> {
    const abortController = new AbortController();
    if (!runRegistry.register(sessionId, abortController)) {
      throw new ServiceError('Session is already running', 409);
    }

    console.log(`[Agent] run start session=${sessionId} input="${input.slice(0, 50)}"`);

    bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });
    this.activityTracker.start(sessionId);

    let result: ReturnType<typeof coreRunAgent>;
    try {
      result = coreRunAgent({
        input: { content: input, timestamp: new Date() },
        sessionId,
        signal: abortController.signal,
        pm: this.providerManager,
      });
    } catch (err) {
      runRegistry.remove(sessionId);
      this.activityTracker.finish(sessionId);
      throw err;
    }

    // Background self-driven consumption: independent of any client connection.
    void this.drive(sessionId, result);
  }

  private async drive(sessionId: string, result: ReturnType<typeof coreRunAgent>): Promise<void> {
    const workspace = this.workspace;
    console.log(`[resume] driver start session=${sessionId}`);
    try {
      for await (const chunk of result.stream.fullStream) {
        this.activityTracker.applyChunk(sessionId, chunk);

        if (chunk.type === 'message-start') {
          streamingSnapshots.start(sessionId, chunk.messageId);
          console.log(`[resume] snapshot start session=${sessionId} messageId=${chunk.messageId}`);
        } else if (isContentChunk(chunk)) {
          const entry = streamingSnapshots.get(sessionId);
          if (entry) {
            try {
              streamingSnapshots.update(sessionId, reduceStreamChunk(entry.parts, chunk));
            } catch {
              // snapshot best-effort
            }
          }
        }

        bus.publish({ workspace, sessionId, type: 'chunk', chunk });

        if (chunk.type === 'finish') {
          streamingSnapshots.clear(sessionId);
          bus.publish({ workspace, sessionId, type: 'session-end' });
        }
        if (chunk.type === 'error') {
          streamingSnapshots.clear(sessionId);
          bus.publish({ workspace, sessionId, type: 'session-error', error: String(chunk.error) });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[resume] driver error session=${sessionId} error=${message}`);
      bus.publish({ workspace, sessionId, type: 'session-error', error: message });
    } finally {
      console.log(`[resume] driver end session=${sessionId}`);
      runRegistry.remove(sessionId);
      streamingSnapshots.clear(sessionId);
      this.activityTracker.finish(sessionId);
    }
  }
```

说明：删除了原 `wrapped` 迭代器、`return wrapped`、以及独立的 `result.output.catch(...).finally(...)`（清理逻辑已并入 `drive` 的 finally）。`self`/`workspace` 局部变量随之移除。`isContentChunk` 辅助函数保留在文件底部不变。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run packages/bridge/tests/agent-service-run.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 6: 提交**

```bash
git add packages/bridge/src/agent-service.interface.ts packages/bridge/src/agent.ts packages/bridge/tests/agent-service-run.test.ts
git commit -m "feat(bridge): self-driven run via background drive(), run() returns void"
```

---

## Task 2: bridge — `AgentRemoteService.run()` 改命令式

**Files:**
- Modify: `packages/bridge/src/agent-remote-service.ts`
- Test: `packages/bridge/tests/client.test.ts`

- [ ] **Step 1: 改写 client.test.ts 的 run 用例为失败态**

把 `packages/bridge/tests/client.test.ts` 第 9-51 行的 `it('requests run and consumes stream', ...)` 替换为：

```typescript
  it('requests run as a command and resolves void', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    const client = new AgentRemoteService('http://localhost:8321');
    const res = await client.run('s1', 'hello');

    expect(res).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8321/api/agent/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when run response is not ok', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const client = new AgentRemoteService('http://localhost:8321');
    await expect(client.run('s1', 'hello')).rejects.toThrow(/500/);
  });
```

（`createSSEResponse` 的 describe 块保持不动。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/bridge/tests/client.test.ts`
Expected: FAIL — 当前 `run()` 返回 AsyncIterable，`res` 不为 undefined。

- [ ] **Step 3: 改 `AgentRemoteService.run`**

`packages/bridge/src/agent-remote-service.ts`，把 `run()`（9-29 行）替换为：

```typescript
  async run(sessionId: string, input: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: input }),
    });

    if (!response.ok) {
      throw new Error(`Agent run failed: ${response.status}`);
    }
  }
```

清理 import：`import type { AgentStreamChunk } from 'rem-agent-core'` 若在文件其余部分未使用则删除（`stream()` 用的是 `BusEvent` + `parseSSEStream`）；`parseAgentStreamEvent` 若仅 `run()` 使用则从 `import { parseSSEStream, parseAgentStreamEvent } from './sse.js'` 中移除，保留 `parseSSEStream`（`stream()` 仍用）。实现后按 esbuild/vitest 通过为准，最终由 Task 6 全仓 typecheck 校验。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/bridge/tests/client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/bridge/src/agent-remote-service.ts packages/bridge/tests/client.test.ts
git commit -m "feat(bridge): AgentRemoteService.run becomes a fire-and-forget command"
```

---

## Task 3: 改写 approval 测试为订阅 bus

**Files:**
- Modify: `packages/bridge/tests/agent-service-approval.test.ts`

**Context:** 该测试原先 `const stream = await service.run(...)` 后 `for await` 消费流以观察 approval-request 并 resolve。`run()` 现返回 void，需改为订阅 `service.stream()` 观察 bus 事件。

- [ ] **Step 1: 替换测试主体**

把 `packages/bridge/tests/agent-service-approval.test.ts` 中的 `it('emits approval-request chunk and resolves via resolveApproval', ...)`（66-103 行）整体替换为：

```typescript
  it('emits approval-request via bus and resolves via resolveApproval', async () => {
    const summary = await service.createSession();

    // Subscribe to the broadcast bus (the only data source now).
    const events: any[] = [];
    const busIterable = service.stream();
    const iterator = busIterable[Symbol.asyncIterator]();
    const pump = (async () => {
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) break;
        events.push(value);
      }
    })();

    await service.run(summary.sessionId, '写一首诗到当前的工作空间');

    // wait until an approval-request chunk shows up on the bus
    let approvalId: string | undefined;
    for (let i = 0; i < 50 && !approvalId; i++) {
      const ev = events.find(
        (e) => e.type === 'chunk' && e.chunk.type === 'approval-request',
      );
      if (ev) approvalId = ev.chunk.request.approvalId;
      else await new Promise((r) => setTimeout(r, 20));
    }
    expect(approvalId).toBeDefined();

    const pending = await service.listPendingApprovals(summary.sessionId);
    expect(pending.some((r) => r.approvalId === approvalId)).toBe(true);

    const resolved = await service.resolveApproval(approvalId!, 'allow-once');
    expect(resolved).toBe(true);

    // wait for resolved + tool-result on the bus
    for (let i = 0; i < 50; i++) {
      const hasResolved = events.some(
        (e) => e.type === 'chunk' && e.chunk.type === 'approval-resolved' && e.chunk.decision === 'allow-once',
      );
      const hasToolResult = events.some(
        (e) => e.type === 'chunk' && e.chunk.type === 'tool-result',
      );
      if (hasResolved && hasToolResult) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'approval-resolved' && e.chunk.decision === 'allow-once')).toBe(true);
    expect(events.some((e) => e.type === 'chunk' && e.chunk.type === 'tool-result')).toBe(true);

    await iterator.return?.();
    await pump.catch(() => {});
  });
```

> `approval-request` / `approval-resolved` 事件在 core 里是作为 stream chunk 出现的（`AgentStreamChunk` 含这两类型），因此它们经 `drive()` 的 `bus.publish({type:'chunk', chunk})` 广播，故用 `e.type === 'chunk' && e.chunk.type === 'approval-request'` 匹配。

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm vitest run packages/bridge/tests/agent-service-approval.test.ts`
Expected: PASS。若因临时目录清理偶发 ENOTEMPTY，afterEach 已有重试；再跑一次确认。

- [ ] **Step 3: 提交**

```bash
git add packages/bridge/tests/agent-service-approval.test.ts
git commit -m "test(bridge): observe approval flow via bus instead of run stream"
```

---

## Task 4: web — run route 返回 JSON + send 去空消费

**Files:**
- Modify: `packages/web/src/app/api/agent/run/route.ts`
- Modify: `packages/web/src/lib/use-agent-bus.ts`

- [ ] **Step 1: 改 run route**

把 `packages/web/src/app/api/agent/run/route.ts` 整体替换为：

```typescript
import { NextRequest } from 'next/server';
import { getAgentService } from '../../../../lib/agent-service.server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, content } = body;

  if (!sessionId || typeof content !== 'string') {
    return new Response('Invalid request', { status: 400 });
  }

  const agentService = getAgentService();
  await agentService.run(sessionId, content);
  return Response.json({ ok: true });
}
```

（移除 `createSSEResponse` import。）

- [ ] **Step 2: 改 `use-agent-bus.ts` 的 `send`**

在 `packages/web/src/lib/use-agent-bus.ts` 中，把 `send` 的实现改为：

```typescript
  const send = useCallback(
    async (sessionId: string, content: string) => {
      await agentService.run(sessionId, content);
      // UI updates come from the broadcast bus, not from this call.
    },
    [agentService],
  );
```

（删除原来的 `const stream = await agentService.run(...)` 与 `for await (const _chunk of stream) {}` 空消费循环。）

- [ ] **Step 3: 编译验证**

Run: `pnpm --filter rem-agent-web run build 2>&1 | tail -15`
Expected: 构建成功。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/app/api/agent/run/route.ts packages/web/src/lib/use-agent-bus.ts
git commit -m "feat(web): run route becomes a command; send no longer consumes a stream"
```

---

## Task 5: tui — 最小编译修复

**Files:**
- Modify: `packages/tui/src/app.ts`

- [ ] **Step 1: 改 handleSubmit 里的 run 消费**

在 `packages/tui/src/app.ts` 的 `handleSubmit`（约 184-188 行），把：

```typescript
      const stream = await this.agentService.run(this.sessionId, text);
      for await (const chunk of stream) {
        this.handleChunk(chunk);
      }
```

替换为：

```typescript
      await this.agentService.run(this.sessionId, text);
      // TODO(server-driven-run): tui 尚未迁移到 bus，流式渲染暂时失效。
      // 后续应订阅 AgentService.stream() 并按 BusEvent 渲染（含 message-start/snapshot/chunk）。
      this.endStream();
      this.running = false;
      this.updateStatus();
```

> 加 `endStream()` + 复位状态，避免发送后 UI 卡在"streaming"态。

- [ ] **Step 2: 处理可能变为未使用的方法**

Run: `pnpm --filter rem-agent-tui typecheck 2>&1 | tail -20`

- 若报 `handleChunk`（或其它私有方法）未使用错误：TypeScript 默认**不**对未使用的私有方法报错（`noUnusedLocals` 只管局部变量/参数）。若确有报错（例如未使用的 import 或局部变量），仅删除这些具体的未使用符号，保留 `handleChunk`/`startStreamMessage`/`endStream`（`startStreamMessage` 仍在第 182 行被调用，`endStream` 现被 Step 1 调用）。
- Expected: PASS（无类型错误）。

- [ ] **Step 3: 提交**

```bash
git add packages/tui/src/app.ts
git commit -m "fix(tui): compile against void run(); streaming render deferred (TODO)"
```

---

## Task 6: 全仓类型检查、测试与手动验证

**Files:** 全仓

- [ ] **Step 1: 全仓类型检查**

Run: `pnpm typecheck`
Expected: PASS（core/bridge/tui 全绿）。若报未使用 import（如 bridge `AgentStreamChunk`、`parseAgentStreamEvent`），删除对应未使用 import 后重跑。

- [ ] **Step 2: 全仓测试**

Run: `pnpm test`
Expected: 全绿。`agent-service-approval.test.ts` 若偶发 ENOTEMPTY，重跑一次。

- [ ] **Step 3: 手动验证续接（agent-browser 或手动）**

启动 dev server，发送一条会产生较长输出的消息，在生成中刷新页面，确认：
- 服务端日志出现 `[resume] driver start` 且刷新后 driver 继续打到 `[resume] driver end`（不随刷新中断）。
- 刷新后已生成内容仍展示，后续 chunk 继续追加，无重复/丢失。
- `{sessionId}.jsonl` 最终包含完整结果。

- [ ] **Step 4: 提交（如有 lint 等附带改动）**

```bash
git add -A
git commit -m "chore: typecheck/test fixes for server-driven run" || echo "nothing to commit"
```

---

## Spec 覆盖自检

| Spec 要求 | 对应 Task |
|---|---|
| run() 返回 void + 后台 drive | Task 1 |
| driver 独立于客户端连接 | Task 1（断开无影响测试） |
| 并发 run 409 | Task 1 |
| IAgentService.run 类型改 | Task 1 |
| AgentRemoteService.run 命令化（移除 SSE 解析） | Task 2 |
| run route 返回 JSON | Task 4 |
| use-agent-bus send 去空消费 | Task 4 |
| tui 最小编译修复 | Task 5 |
| approval 测试改 bus | Task 3 |
| client 测试改 run 断言 | Task 2 |
| createSSEResponse 保留 | 不改（Task 2 仅移除 run 用法，其测试不动）|
| core 不改 | 全程 |

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-07-06-server-driven-run-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 每个 task 派发独立 subagent，task 间双重 review

**2. Inline Execution** - 当前会话用 executing-plans 批量执行带检查点

Which approach?
