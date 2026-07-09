---
name: web-debugging-with-agent-browser
description: |
  MUST USE when debugging any web UI bug in the Rem Agent project, especially for streaming content,
  async state, tool-call rendering, session refresh behavior, or anything where the browser state
  differs from the server/DB state. Invoke this skill BEFORE writing code, applying fixes, or running
  tests, so that reproduction and verification are done with agent-browser instead of manual clicks.
  Key triggers: "stream", "streaming", "卡住", "卡住不动", "刷新后", "refresh", "tool call",
  "函数调用", "calling-function", "UI", "页面", "browser", "前端", "DOM".
---

# Web Debugging with agent-browser

## Overview

When a bug only reproduces in the browser, use `agent-browser` to drive the UI, inspect the DOM, and verify the fix end-to-end without relying on the user to click or refresh manually. This skill covers the full debug loop: reproduce → inspect backend → apply fix → re-verify → clean up.

## When to Use

- The bug involves streaming UI updates, event handling, or async state.
- The user reports "refresh shows X but live stream shows Y".
- A client-side crash appears in the browser console.
- Manual browser interaction is required to reproduce.
- You need to verify that a fix actually renders correctly.

## Core Workflow

```
1. Start the web server on a free port (3000 or 3001) in the background
2. Open the page with agent-browser
3. Reproduce the scenario (click, fill, submit, wait)
4. Inspect the DOM / read content / take screenshot
5. Check server logs AND call backend API directly to narrow down the layer
6. Apply the fix
7. Restart if needed and re-run the exact scenario
8. Confirm fix with DOM inspection + API response + logs
9. Clean up ports and browser session
```

## Step-by-Step

### 1. Start the server

Pick a free port and start the web dev server:

```bash
# Make sure no stale processes are holding ports
for pid in $(lsof -ti:3000,3001 2>/dev/null); do kill -9 $pid 2>/dev/null; done

PORT=3001
pnpm --filter rem-agent-web dev --port $PORT > /tmp/web.log 2>&1 &
echo $! > /tmp/web.pid
sleep 5
```

Tail the log while debugging:

```bash
tail -f /tmp/web.log
```

### 2. Open the page

```bash
agent-browser open http://localhost:3001 --timeout 30000
```

### 3. Reproduce the scenario

```bash
# See interactive elements
agent-browser snapshot -i -d 5

# Common chat interaction pattern
agent-browser click @e1                    # New Chat (optional)
agent-browser type @e10 "user question"
agent-browser click @e12                   # Send

# Wait for streaming / tool calls to finish
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  agent-browser screenshot /tmp/rem-$i.png
done
```

### 4. Inspect rendered content

```bash
# Read visible text from message list
agent-browser eval "Array.from(document.querySelectorAll('.py-3')).map(el => el.textContent).slice(-10)"

# Get a specific tool-call button's HTML to check status
agent-browser get html @e14

# Verify output appeared
agent-browser read --filter "expected keyword"
```

### 5. Cross-check backend state

When the UI looks wrong, call the same API the UI uses to isolate client vs server issues:

```bash
# List sessions
curl -s http://localhost:3001/api/sessions | python3 -m json.tool | head -20

# Get persisted messages for the active session
curl -s http://localhost:3001/api/sessions/<sessionId> | python3 -m json.tool | tail -100

# Read the raw session file directly (if using FileSessionProvider)
cat packages/web/.rem-agent/sessions/<sessionId>.json | python3 -m json.tool | tail -100
```

Also inspect the server log for errors, 400s from LLM providers, or missing chunks:

```bash
grep -a -E "(Error|400|chunk session=.*type=(text|tool|finish))" /tmp/web.log | tail -40
```

If the API response already shows the bug, the fix is in core/bridge, not web.

## Using the Built-in Debug Logs

The project has a structured logging system in `packages/core/src/shared/debug-log.ts`.
In dev mode (`NODE_ENV=development`) it prints to the terminal **and** writes to
`<agentDir>/debug.log` automatically.

### Where to find the logs

- **Terminal**: when you start `pnpm --filter rem-agent-web dev`, logs are mixed into `/tmp/web.log` or the terminal where you ran it.
- **File**: `packages/web/.rem-agent/debug.log` (because the web dev server runs from `packages/web`).

### Useful log tags for streaming issues

| Tag | File(s) | What it tells you |
|---|---|---|
| `api:stream` | `packages/web/src/app/api/agent/stream/route.ts` | When SSE connections are established / fail |
| `sse` | `packages/bridge/src/agent.ts`, `packages/web/src/lib/use-agent-bus.ts` | Bus subscriber events, snapshot replays, reconnections |
| `agent:lifecycle` | `packages/bridge/src/agent.ts` | Run start/finish/interrupt, chunk consumption count |
| `stream` | `packages/core/src/stream/agent-stream.ts` | When text/reasoning/tool parts start and finish |
| `state` | `packages/core/src/state.ts` | Activity changes (`pending` → `thinking` → `outputting` → `idle`) |
| `reason` / `llm:engine` | `packages/core/src/reason/reason.ts`, `packages/core/src/llm/engine.ts` | LLM inference start/end, retry attempts |
| `openai` / `anthropic` | Provider adapters | Raw provider chunks |
| `session` | `packages/core/src/plugins/session/jsonl-store.ts` | When sessions are loaded/saved |
| `tools` | `packages/core/src/execute/execute-tools.ts` | Tool calls, approvals, results |

### Common streaming-specific log checks

```bash
# Follow the log in real time
tail -f packages/web/.rem-agent/debug.log

# See activity transitions during a request
grep -a "activity changed" packages/web/.rem-agent/debug.log

# See reasoning/text part lifecycle
grep -a -E "reasoning part|text part|stream finished" packages/web/.rem-agent/debug.log

# See if the run completed normally or errored
grep -a -E "run finished|run failed|run aborted" packages/web/.rem-agent/debug.log

# See SSE reconnections from the browser
grep -a -E "sse.*reconnect|new bus subscriber" packages/web/.rem-agent/debug.log
```

### Adding temporary logs

If built-in logs are not enough, add focused temporary logs, rebuild, and restart.

Use the `log()` helper (preferred) or the older `debugLog()`:

```typescript
import { log } from 'rem-agent-core';

log('debug:my-feature', 'something happened', {
  sessionId: '...',
  workspace: '...',
  chunkType: chunk.type,
});
```

Context values are appended as `key=value` pairs, so the log line becomes:

```
[debug:my-feature] sessionId=... workspace=... chunkType=text-delta something happened
```

For browser-only code (client components), `rem-agent-core` imports won't work because the logger uses Node's `fs`. Use a small browser-safe helper instead:

```typescript
function sseLog(message: string, context?: Record<string, unknown>): void {
  const ctx = context ? Object.entries(context).map(([k, v]) => `${k}=${String(v)}`).join(' ') : '';
  console.log(`[sse]${ctx ? ` ${ctx}` : ''} ${message}`);
}
```

Common temporary log points:

```bash
# - packages/core/src/llm/providers/openai-adapter.ts  (raw chunk parsing)
# - packages/core/src/loop-strategy.ts                 (inferResult after LLM call)
# - packages/core/src/turn.ts                          (newMessages at turn end)
# - packages/bridge/src/agent.ts                       (chunk persistence)

pnpm --filter rem-agent-core build
kill $(cat /tmp/web.pid)
PORT=3001
pnpm --filter rem-agent-web dev --port $PORT > /tmp/web.log 2>&1 &
echo $! > /tmp/web.pid
sleep 5
```

Remember to remove temporary logs before committing.

### When logs point to the root cause

- **Only `reasoning-*` chunks, no `text-start`**: the model produced thinking tokens but stopped before text. Check provider token limits / thinking budget.
- **`activity` stays `thinking` and then run finishes**: final answer may be inside reasoning; check the provider/model behavior.
- **`sse` reconnect with no subsequent chunks**: the bus stream disconnected; check network / provider stream.
- **`session` save errors**: persistence layer issue; check disk permissions.

### 6. Apply the fix and re-verify

After each code change:

```bash
pnpm typecheck
pnpm test

# Restart server if core or bridge changed
kill $(cat /tmp/web.pid)
PORT=3001
pnpm --filter rem-agent-web dev --port $PORT > /tmp/web.log 2>&1 &
echo $! > /tmp/web.pid
sleep 5

# Re-run the exact reproduction steps with agent-browser
agent-browser open http://localhost:3001 --timeout 30000
# ... click, fill, wait, inspect, call API, check logs
```

A fix is NOT verified until:
- DOM shows the expected final state.
- `/api/sessions/<id>` returns correct persisted messages.
- Server logs show no unexpected errors.
- `pnpm typecheck` and `pnpm test` pass.

### 7. Clean up

```bash
agent-browser close --all
kill $(cat /tmp/web.pid) 2>/dev/null || true
for pid in $(lsof -ti:3000,3001 2>/dev/null); do kill -9 $pid 2>/dev/null; done
lsof -ti:3000,3001 2>/dev/null || echo "ports 3000 and 3001 are free"
```

## Common Patterns

| Goal | Command |
|---|---|
| Verify text appeared | `agent-browser read --filter "keyword"` |
| Verify element state | `agent-browser snapshot -i -d 5` |
| Wait for async content | `for i in 1..N; do sleep 2; agent-browser snapshot -i -d 5; done` |
| Check input value | `agent-browser get value @eN` |
| Read message list text | `agent-browser eval "Array.from(document.querySelectorAll('.py-3')).map(el => el.textContent).slice(-10)"` |
| Reproduce after server restart | kill server, restart, re-open page, replay steps |
| Isolate client vs server bug | Compare UI state with `/api/sessions/<id>` response |
| Check LLM provider errors | `grep -a -E "(Error|400|chunk session=)" /tmp/web.log` |

## Integration with Code Fixes

1. Reproduce with `agent-browser` first; do not change code before reproduction.
2. Cross-check the backend API response to find the faulty layer.
3. Add temporary logs only when needed; remove them before finishing.
4. Apply the smallest fix that addresses the root cause.
5. Re-run the exact reproduction steps and verify DOM + API + logs.
6. Run `typecheck` and tests.
7. Clean up server, browser, and ports.

## Red Flags

- Changing code without reproducing first.
- Verifying only by reading code or running unit tests, not by browser inspection.
- Trusting a fix because "it should work" without checking the UI, API, and logs.
- Leaving the dev server running or ports occupied after finishing.
- Forgetting to remove temporary debug logs.
