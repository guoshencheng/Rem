# Runtime Single-Stack Cutover Implementation Plan

**Goal:** Make `AgentRuntime + /v1 + RuntimeClient` the only active execution path while preserving the completed Run, Team, child, waiting, journal, artifact, and SSE semantics.

**Architecture:** Replace the legacy `AgentAssembly`/`REMAgent` boundary with runtime bootstrap ports and a stateless internal agent loop. Migrate Web to Runtime-only view models and routes, then remove legacy exports, stores, routes, and tests after the new path has equivalent coverage.

**Tech Stack:** TypeScript, Node.js 22, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, SQLite, Fetch/SSE, React, Vitest.

---

### Task 1: Runtime bootstrap ports and stateless agent loop

- Add runtime-only config/storage/model port types under `packages/core/src/sdk/`.
- Refactor `createAgentRuntime` and `createAgentRuntimeFromEnv` to consume those ports, freeze `executionRoot`, and keep credentials out of snapshots/logs.
- Add a focused `execution/agent-loop/` implementation using `runAgentLoop` and `runAgentLoopContinue`.
- Move tool bridging, message persistence callbacks, model failure mapping, and live-signal projection out of `REMAgentRunExecutor`.
- Add runtime tests for initialization, resume, tool loops, cancellation, timeout, and storage ownership.

### Task 2: Runtime-only configuration and SQLite provider

- Narrow configuration reads to runtime defaults/model resolution; remove agent/team/workspace resolution from the runtime path.
- Introduce `SqliteRuntimeStorageProvider` exposing only `RuntimeStorage` lifecycle and repositories.
- Stop compiling legacy Session/Todo/Archive/Workspace/Thread/orchestration stores and DDL; leave existing legacy tables untouched.
- Rename active filesystem boundary from `workspaceRoot` to `executionRoot` and preserve path safety.
- Keep Fake and SQLite Runtime contract tests identical.

### Task 3: Web Runtime-only cutover

- Make `createWebApp` require Runtime and mount only `/v1`; `/api/rem/*` must return 404.
- Remove workspace CLI arguments, legacy AgentSystem construction, and old server routes.
- Replace Web legacy session/thread/bus types with local Runtime view models.
- Add AgentDefinition loading and an agent selector to the Run launcher; `sendMessage` always supplies `agentId`.
- Remove legacy bus/SSE/reducer/Thread/Collaboration UI and add waiting resolution controls to the execution inspector.
- Preserve request-count guarantees: initial sessions/agents only, entries on selection, one stream per send.

### Task 4: Public API and documentation cutover

- Restrict `packages/core/src/index.ts` and package exports to Runtime, domain, plugin, tool, storage, and error APIs.
- Remove legacy AgentSystem/Assembly/REMAgent/SessionRuntime/AgentThread/Delivery/workspace exports and imports.
- Update README, architecture, Service/Client docs, AGENTS, and migration notes to describe only Runtime.
- Add static checks preventing legacy imports, `/api/rem` source references, and active `workspace` terminology.

### Task 5: Acceptance and cleanup

- Replace legacy-only tests with Runtime equivalents; keep all single-agent, Team, child, waiting, journal, artifact, SSE, Service, Client, and Web coverage.
- Add dedicated-port browser smoke harness with a deterministic model and verify DOM streaming, refresh recovery, waiting actions, and `/api/rem` 404.
- Run `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:structure`, `git diff --check`, and legacy-reference scans.

**Assumptions:** The repository is private `0.1.0`; this is a breaking cutover with no legacy data migration. Existing Runtime tables and `/v1` wire contracts remain compatible. Distributed workers, PostgreSQL, webhooks/outbox, and general approval workflows remain out of scope.
