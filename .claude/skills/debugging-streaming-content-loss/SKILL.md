---
name: web-debugging-with-agent-browser
description: Use when debugging a web application that requires browser interaction, live reproduction, and DOM verification to confirm fixes.
---

# Web Debugging with agent-browser

## Overview

When a bug only reproduces in the browser, use `agent-browser` to drive the UI, inspect the DOM, and verify the fix end-to-end without relying on the user to click or refresh manually.

## When to Use

- The bug involves streaming UI updates, event handling, or async state.
- The user reports "refresh shows X but live stream shows Y".
- A client-side crash appears in the browser console.
- Manual browser interaction is required to reproduce.
- You need to verify that a fix actually renders correctly.

## Core Workflow

```
1. Start the web server in the background
2. Open the page with agent-browser
3. Reproduce the scenario (click, fill, submit, wait)
4. Inspect the DOM / read content / take screenshot
5. Check server logs for backend behavior
6. Apply the fix
7. Restart if needed and re-run the scenario
8. Confirm fix with DOM inspection + logs
```

## Step-by-Step

### 1. Start the server

```bash
pnpm --filter rem-agent-web dev > /tmp/web.log 2>&1 &
echo $! > /tmp/web.pid
sleep 5
```

Tail the log while debugging:

```bash
tail -f /tmp/web.log
```

### 2. Open the page

```bash
agent-browser open http://localhost:3000 --timeout 30000
```

### 3. Interact with the page

```bash
# See interactive elements
agent-browser snapshot -i -d 3

# Click, fill, submit
agent-browser fill @e11 "user input"
agent-browser click @e13

# Wait for async updates
sleep 5
agent-browser snapshot -i -d 3
```

### 4. Extract rendered content

```bash
# Read text from the page
agent-browser read --filter "expected heading"

# Get a specific element's text
agent-browser get text @e9
```

### 5. Verify the fix

After applying code changes:

```bash
# Restart server if the change affects server code
kill $(cat /tmp/web.pid)
pnpm --filter rem-agent-web dev > /tmp/web.log 2>&1 &
echo $! > /tmp/web.pid
sleep 5

# Re-run the reproduction scenario
agent-browser open http://localhost:3000 --timeout 30000
# ... click, fill, wait, inspect
```

### 6. Clean up

```bash
agent-browser close
kill $(cat /tmp/web.pid) 2>/dev/null || true
```

## Common Patterns

| Goal | Command |
|---|---|
| Verify text appeared | `agent-browser read --filter "keyword"` |
| Verify element state | `agent-browser snapshot -i -d 3` |
| Wait for async content | `sleep N && agent-browser snapshot` |
| Check input value | `agent-browser get value @eN` |
| Reproduce after server restart | restart server, re-open page, replay steps |

## Integration with Code Fixes

1. Reproduce with `agent-browser` first.
2. Add temporary logs at both server and client if needed.
3. Apply the fix.
4. Re-run the exact reproduction steps.
5. Confirm the DOM and server logs are correct.
6. Remove temporary logs.
7. Run `typecheck` / tests.

## Red Flags

- Changing code without reproducing first.
- Verifying only by reading code, not by browser inspection.
- Leaving the dev server running after finishing.
- Forgetting to remove temporary debug logs.
