# Core-only Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the archived Bridge package from the active workspace and establish a clean, documented, independently buildable Core-only baseline.

**Architecture:** `packages/core` becomes the only active workspace package. Root scripts, TypeScript references, Vitest aliases, the lockfile, and current-state documentation are reduced to Core; historical documents and the tracked `archive/` tree remain unchanged.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Git

---

## File Structure

- Delete `packages/bridge/`: active Bridge source, tests, package metadata, and generated files.
- Modify `package.json`: expose only Core build, typecheck, tests, and structure checks.
- Modify `tsconfig.json`: retain only the Core project reference.
- Modify `vitest.config.ts`: retain only the Core source alias and Core tests.
- Modify `pnpm-lock.yaml`: remove the `packages/bridge` importer by regenerating the lockfile.
- Modify `README.md`: describe the current Core-only rebuilding phase.
- Modify `AGENTS.md`: make Core ownership and Core-only commands authoritative for future agents.
- Modify `docs/architecture.md`: replace the stale multi-package architecture with the current Core target boundary.
- Modify `docs/module-reference.md`: retain only the active Core module reference and point historical readers to `archive/`.

No production TypeScript module is created in this phase. The next implementation plan starts from this clean baseline and migrates the archived single-Agent Session runtime into focused Core modules.

### Task 1: Verify Archive Safety and Remove the Active Bridge Package

**Files:**

- Delete: `packages/bridge/`
- Verify: `archive/bridge/`

- [ ] **Step 1: Verify the archived Bridge is tracked and the worktree is clean**

Run:

```bash
git status --short
test -d archive/bridge/src
test -d archive/bridge/tests
test "$(git ls-files archive/bridge | wc -l | tr -d ' ')" -gt 0
```

Expected: `git status --short` prints nothing and all three archive assertions exit with code 0.

- [ ] **Step 2: Record the current Core baseline before deletion**

Run:

```bash
pnpm --filter rem-agent-core build
pnpm --filter rem-agent-core typecheck
pnpm vitest run packages/core/tests
pnpm --filter rem-agent-core check-structure
```

Expected: all four commands exit with code 0. If any command fails, stop and report the pre-existing Core failure before deleting Bridge.

- [ ] **Step 3: Delete only the active Bridge package**

Run:

```bash
git rm -r packages/bridge
```

Expected: Git stages deletion of `packages/bridge`; `archive/bridge` remains present and unchanged.

- [ ] **Step 4: Verify the deletion boundary**

Run:

```bash
test ! -d packages/bridge
test -d packages/core
test -d archive/bridge
git status --short
```

Expected: all assertions pass; status contains only staged `packages/bridge` deletions.

### Task 2: Reduce Root Tooling to Core-only

**Files:**

- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Replace root scripts with Core-only commands**

Update `package.json` scripts to exactly:

```json
{
  "scripts": {
    "build": "pnpm --filter rem-agent-core build",
    "test": "vitest run packages/core/tests",
    "test:watch": "vitest packages/core/tests",
    "typecheck": "pnpm --filter rem-agent-core build && pnpm --filter rem-agent-core typecheck",
    "check:structure": "pnpm --filter rem-agent-core check-structure"
  }
}
```

Preserve the existing package name, version, privacy, module type, engine, and dev dependencies. Do not remove `@testing-library/jest-dom`, because `packages/core/tests/setup.ts` imports it.

- [ ] **Step 2: Keep only the Core TypeScript project reference**

Replace the root `references` array in `tsconfig.json` with:

```json
"references": [
  { "path": "./packages/core" }
]
```

Preserve all compiler options.

- [ ] **Step 3: Keep only the active Core Vitest alias**

Replace `vitest.config.ts` with:

```typescript
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/core/**/*.test.ts'],
    setupFiles: ['packages/core/tests/setup.ts'],
  },
  resolve: {
    alias: [
      {
        find: 'rem-agent-core',
        replacement: resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      },
    ],
  },
});
```

This phase does not retain aliases for archived packages. Core subpath aliases are unnecessary because active Core tests import the root package or relative modules.

- [ ] **Step 4: Regenerate the lockfile without Bridge importer**

Run:

```bash
pnpm install --lockfile-only
```

Expected: command exits with code 0 and `pnpm-lock.yaml` no longer has a top-level `packages/bridge:` importer.

- [ ] **Step 5: Verify no active root configuration references archived packages**

Run:

```bash
rg -n "rem-agent-(bridge|routes|ui|web)|packages/(bridge|routes|ui|web)" \
  package.json tsconfig.json vitest.config.ts pnpm-workspace.yaml pnpm-lock.yaml
```

Expected: no matches and `rg` exits with code 1.

### Task 3: Update Current-state Documentation

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `docs/module-reference.md`

- [ ] **Step 1: Replace README with the Core-only project state**

Use this content:

````markdown
# Rem Agent

一个 Agent-first 的 TypeScript 通用 Agent Harness。项目当前处于 Core-first 重建阶段，活动 workspace 只保留 `rem-agent-core`；旧 Bridge、Routes、UI 和 Web 实现保存在 `archive/`。

## 目标

- Core 独立提供 Session、Agent 生命周期、事件、预算、工具与持久化能力
- 在 Core 中逐步建设单 Agent、一次性 child Agent 和 Organizer 驱动的长期多 Agent
- 传输协议和 UI 在 Core 公共 API 稳定后重新向上建设

## 环境要求

- Node.js >= 22.19.0
- pnpm

## 活动结构

```text
packages/
  core/    — rem-agent-core：完整 Agent Harness 的唯一活动实现
archive/   — 旧 Core、Bridge、Routes、UI、Web 实现，仅供历史参考
```

## 开发命令

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm check:structure
```

## 文档

- [Core Agent System 重建设计](docs/superpowers/specs/2026-07-31-core-agent-system-rebuild-design.md)
- [当前架构](docs/architecture.md)
- [Core 模块参考](docs/module-reference.md)
- [Core 早期设计（历史）](docs/core-design.md)
````

- [ ] **Step 2: Update AGENTS.md current structure and commands**

Make these exact semantic changes while preserving the existing provider, pi-agent-core, direct pi types, module-separation, testing, and Chinese-language rules:

````markdown
## 项目结构

```text
packages/
  core/    — rem-agent-core：完整 Agent Harness 的唯一活动实现
archive/   — 旧 Core、Bridge、Routes、UI、Web 实现，仅供历史参考，不在活动 workspace 中修改
```

当前阶段先把 Session、单 Agent、一次性 child Agent、AgentThread、中心消息投影和 Organizer/Scheduler 完整建设在 Core，再重新向上建设接入层与 UI。
````

Set the command table to `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm check:structure`. Remove Bridge/UI/Routes common-entry rows and add the accepted rebuild design document to the deep-document table.

- [ ] **Step 3: Replace docs/architecture.md with the active boundary**

The replacement document must contain these sections and statements:

```markdown
# Rem Agent — 当前架构

> 状态：Core-first 重建阶段（2026-07-31）

## 活动边界

`packages/core` 是唯一活动包。`archive/` 保存旧实现，不参与 workspace 构建。

## 依赖原则

Core 提供完整 Agent System；未来接入层只能依赖 Core，Core 不依赖传输协议或 UI。

## 当前 Core 能力

记录现有 REMAgent、assembly、runtime、session、sdk、plugins、security、tools 和 capabilities 目录职责。

## 目标 Core 能力

记录 Session、AgentThread、中心消息投影、单 Agent runtime、one-shot delegation、Organizer/Scheduler 和 AgentSystem 门面。

## 重建顺序

引用 `docs/superpowers/specs/2026-07-31-core-agent-system-rebuild-design.md` 的七阶段顺序。
```

Write each section with concrete current module names from `packages/core/src`; do not describe archived packages as active layers.

- [ ] **Step 4: Replace docs/module-reference.md with Core-only reference**

The replacement must enumerate the active directories returned by:

```bash
find packages/core/src -mindepth 1 -maxdepth 1 -type d | sort
```

For each directory, document its current responsibility and key entry files. Add a final “planned modules” section that clearly labels `system/`, `orchestration/`, Session runtime, AgentThread, and delegation runner as planned rather than already implemented.

- [ ] **Step 5: Verify current documents have no active-package claims for archived layers**

Run:

```bash
rg -n "packages/(bridge|routes|ui|web)|rem-agent-(bridge|routes|ui|web)" \
  README.md AGENTS.md docs/architecture.md docs/module-reference.md
```

Expected: references appear only in explicit historical/archive statements, never in an active package list, command, or dependency diagram.

### Task 4: Verify and Commit the Core-only Baseline

**Files:**

- Verify all files changed in Tasks 1–3.

- [ ] **Step 1: Install from the regenerated Core-only lockfile**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: command exits with code 0 and reports only the root project plus `rem-agent-core` in workspace scope.

- [ ] **Step 2: Run all Core gates**

Run:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm check:structure
```

Expected: all commands exit with code 0.

- [ ] **Step 3: Check deletion, references, and diff hygiene**

Run:

```bash
test ! -d packages/bridge
test -d archive/bridge
test -d packages/core
git diff --check
git status --short
```

Expected: directory assertions and `git diff --check` pass; status contains only the intended Bridge deletion, root configuration, lockfile, and current-document changes.

- [ ] **Step 4: Commit the Core-only baseline**

```bash
git add package.json tsconfig.json vitest.config.ts pnpm-lock.yaml README.md AGENTS.md docs/architecture.md docs/module-reference.md
git add -u packages
git commit -m "refactor: establish core-only workspace"
```

- [ ] **Step 5: Confirm clean final state**

Run:

```bash
git status --short
git log -2 --oneline
```

Expected: clean status; newest commit is `refactor: establish core-only workspace` and the preceding planning commit documents this implementation plan.
