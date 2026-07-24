# 浏览器本地 Agent（LocalAgentService + RemLocalApp）设计

日期：2026-07-24
状态：已确认

## 背景与目标

让 `runAgent` / AgentService 能直接在浏览器中运行，并提供一个纯前端 demo：

1. **Core 平台无关化**：`runAgent` 及其静态 import 链在浏览器可加载、可运行，Node 依赖全部收口到 provider 默认实现。
2. **浏览器版 `LocalAgentService`**：镜像现有 `AgentService`，全部依赖注入为纯前端实现（IndexedDB 存储、空工具集、内嵌模板）。
3. **UI 改造**：`RemApp`/`RemChat` 从 `apiPrefix` 改为 `service: IAgentService` 必传（破坏性），区分 Remote（HTTP）与 Local（浏览器内）两种实现。
4. **新组件 `<RemLocalApp />`**：内置 API key 设置面板，装配 LocalAgentService，demo 包零配置开箱即用。
5. **新 demo 包 `packages/local-demo`**：Vite 纯静态 SPA，引用 `<RemLocalApp />`。

## 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| LLM 调用 | 用户在 UI 填写 API key，保存到 **IndexedDB**，浏览器 fetch 直连 provider |
| 浏览器工具集 | 空工具集 + 演示自定义工具注入（demo 注册 1-2 个纯 JS 工具） |
| 浏览器存储 | 原生 IndexedDB 实现 `StorageProvider`，不引入 sql.js/WASM |
| UI props | `service: IAgentService` **必传**（破坏性变更），删除 apiPrefix/baseUrl |
| 整体形态 | 新组件 `<RemLocalApp />` 做到 UI 包里；新建独立 demo 包引用它 |
| API key 输入 UI | `RemLocalApp` 内置 key 设置面板 |
| 顺带修复 | 全部纳入：2 个 bug + 2 处接口外 fetch 收口 + `searchSessions` 接口扩展 |
| 总体方案 | 方案 A：Core 平台无关化 + buildAgentContext 注入点补全 |

## 现状关键事实（调查结论）

- `runAgent` 体内直接引用 `process.*`：`run-agent.ts:131`（`process.env`）、`:206-209`（`process.platform/version/cwd()`）。
- 模块加载级 Node import：`shared/debug-log.ts:1`（顶层 `fs/promises`）、`session.ts:1` 与 `shared/generate-id.ts:1`（`crypto`）、`security/workspace-root-guard.ts`（顶层 `node:fs/path/url/os`，经 `execute-tools.ts` 静态拉入）。
- `agent-context-builder.ts` 硬编码 Node 默认 provider（Sqlite/File 系），仅 `storageProvider`/`models`/`paths` 可注入。
- 系统提示模板 `claude-template.ts:15`/`openai-template.ts:15` 运行时 `readFile(__dirname/*.md)`。
- `mcp/connection-manager.ts:2` 顶层静态 import `StdioClientTransport`。
- `better-sqlite3` 是唯一原生 C++ 依赖，必须移除出浏览器链路。
- pi-ai 半可移植：主体 fetch-based 且有 `process` 守卫，但含 `@smithy/node-http-handler`、`http-proxy-agent`、`https-proxy-agent` 等 Node-only 间接依赖。
- bridge：`AgentService`（`agent.ts:13`）内部硬编码 `buildAgentContext`（:30）自举；`stream()` 是纯内存 AsyncIterable，浏览器可直接复用；SSE codec（`sse.ts`/`response.ts`）为纯 JS。
- UI：`AgentRemoteService` 仅在 `rem-app.tsx:19`、`rem-chat.tsx:17` 两处 new，下游全部以 `IAgentService` 类型透传；`agent-bus.ts` 模块级单例在 service 引用变化时自动重连。
- 接口外 fetch 2 处：`rem-app.tsx:85`（session 搜索）、`session-item.tsx:32-39`（rename/pin，且硬编码 `/api` 前缀是 bug）。
- bug 2 个：`session-item.tsx` 硬编码前缀；`rem-app.tsx:63-71` removeWorkspace 不调 service。

## 设计

### 1. Core 平台无关化

目标：`runAgent` 及其静态 import 链在浏览器可加载、可运行；Node 默认行为零回归。

1. **Runtime 信息注入**
   - `AgentContext` 新增字段：
     ```ts
     runtime: {
       platform: string;
       nodeVersion?: string;
       cwd: string;
       env: Record<string, string | undefined>;
     }
     ```
   - `run-agent.ts:131,206-209` 的 `process.env/platform/version/cwd()` 全部改读 `ctx.runtime`。
   - `buildAgentContext` 默认填 `process.*`（Node 行为不变）。
   - `plugins/compressor/llm-summary/index.ts:43,47` 等直接读 `process.env` 的位置同步改读 `ctx.runtime.env`（或构造时注入）。

2. **修顶层 Node import**
   - `shared/debug-log.ts`：改为注入式 log sink；`fs` 版 sink 移到 Node-only 子模块（如 `shared/debug-log-file.ts`），core 平台无关入口不再静态引用。
   - `session.ts:1`、`shared/generate-id.ts:1`：`import { randomUUID } from 'crypto'` → `globalThis.crypto.randomUUID()`（Node 22 与浏览器均支持）。
   - `security/workspace-root-guard.ts`：拆分为纯规则匹配逻辑（平台无关，留 core）与 fs 路径解析（移入 file-system 工具插件内部）；`execute-tools.ts` 只依赖纯逻辑。

3. **buildAgentContext 注入点补全**
   - `AgentContextBuildOptions` 新增可选注入：`sessionProvider?`、`configProvider?`、`toolProvider?`、`skillProvider?`、`compressor?`、`systemPromptAssembler?`、`instructionLoader?`、`runtime?`。
   - 缺省时走现有 Node 默认实现；默认实现改为懒加载（动态 import），避免浏览器打包拉入 Node-only 模块。

4. **模板内联**
   - `claude-template.ts`/`openai-template.ts` 的运行时 `readFile(__dirname/*.md)` 改为构建期生成的内联字符串常量（生成 `.ts` 常量模块，Node/浏览器同一份代码），替换现有 `scripts/copy-templates.mjs` 的运行时拷贝方案。

5. **MCP transport 拆分**
   - `connection-manager.ts` 的 `StdioClientTransport` 改动态 import，仅在配置含 stdio server 时加载；SSE/HTTP transport 保持静态。

6. **条件导出**
   - core `package.json` `exports` 增加 `browser` 条件（或 `rem-agent-core/browser` 子路径），排除 Node-only barrel 导出。

### 2. 浏览器 Provider + LocalAgentService（`rem-agent-bridge/local`）

存放：bridge 新增子路径导出 `rem-agent-bridge/local`，与 `rem-agent-bridge/client`（remote）对称。浏览器专用代码不进主入口。

1. **`IndexedDBStorageProvider`**（实现 core `StorageProvider` 接口）
   - 单个 IndexedDB database（`rem-agent`），object store 对应现有 Sqlite 实现的表：`sessions`、`todos`、`rules`、`archives`、`workspaces`；session 消息随 session record 存储（沿用现有 session 序列化格式）。
   - 用 index 支持按 workspace 查询与 `searchSessions(workspace, q)` 搜索。
   - 原生 IndexedDB API 薄封装（promise 化 helper，<100 行），不引入第三方库。

2. **浏览器默认 Provider 组**
   - `InMemoryConfigProvider`：config 由构造参数给，不读文件。
   - `NoopSkillProvider`：空 skills（或从内嵌常量加载）。
   - 空工具集：`ToolComposer` 默认无工具；options 传入的自定义 `tools` 正常注册。
   - `runtime`：`{ platform: 'web', cwd: '/', env: {} }`。

3. **`CredentialStore`**
   - IndexedDB 独立 store，record：`{ provider: 'anthropic' | 'openai' | string, apiKey: string, model?: string, baseURL?: string }`。
   - `models` 注入：根据存储凭据调用 core 已有的 `createCoreModels({ provider, apiKey, ... })`，不经过 `process.env`。

4. **`LocalAgentService implements IAgentService`**（`bridge/src/local/agent-local-service.ts`）
   - 镜像 `AgentService` 逻辑（run/interrupt/reset/会话 CRUD/审批/todos/stream）。
   - 构造参数：`{ credentials, tools?, maxTurns?, name?, ... }`。
   - 内部走 `buildAgentContext`（全部注入浏览器实现）+ core `runAgent`。
   - `stream()` 复用现有内存事件总线（AsyncIterable，无 SSE）。
   - 与 `AgentService` 共享的逻辑（如 `AgentSessionManager`）抽共用模块，不复制代码。

5. **接口扩展与顺带修复**
   - `IAgentService` 新增 `searchSessions(workspace: string, q: string): Promise<SessionMeta[]>`；`AgentRemoteService`（走已有 `GET /sessions?q=`）、`AgentService`、`LocalAgentService` 三实现同步。
   - 修 `session-item.tsx` 硬编码 `/api` → 走 `service.updateSession`。
   - 修 `rem-app.tsx:63-71` removeWorkspace 补调 `service.removeWorkspace`。

6. **pi-ai 打包约束**
   - 浏览器 bundle 需 `resolve.alias` 将 `@smithy/node-http-handler`、`http-proxy-agent`、`https-proxy-agent` 指向空模块 stub（demo 包 Vite config 落实）。

### 3. UI 改造 + RemLocalApp

1. **RemApp / RemChat 破坏性改造**
   ```ts
   interface RemAppProps { service: IAgentService; className?: string }
   interface RemChatProps { service: IAgentService; sessionId: string; workspace?: string; className?: string }
   ```
   - 删除 `apiPrefix`/`baseUrl` props；组件内不再 `new AgentRemoteService`。
   - `rem-app.tsx:85` 搜索改走 `service.searchSessions`。
   - `session-item.tsx` rename/pin 通过 props 链路接收 service，调 `service.updateSession`。
   - `rem-agent-ui` 从 `rem-agent-bridge/client` re-export `IAgentService` 类型与 `AgentRemoteService`。
   - web 包 `page.tsx` 适配：自行 `new AgentRemoteService('', { apiPrefix: '/api/rem' })` 传入。

2. **`<RemLocalApp />`**（`packages/ui/src/components/rem-local-app.tsx`）
   ```
   RemLocalApp
    ├─ 未配置凭据 → <CredentialSetup />（provider 下拉 + key 输入 + model 输入，
    │               保存到 CredentialStore/IndexedDB，保存后进入主界面）
    ├─ 已配置 → 装配 LocalAgentService（useMemo/useRef 单例）
    │            └─ 渲染 <RemApp service={localService} />
    └─ 设置入口（侧边栏齿轮）：重新打开 CredentialSetup 修改 key
   ```
   - Props：`{ tools?: pi.Tool[]; maxTurns?: number; className?: string }`。
   - 凭据变更时销毁旧 service 重建（agent-bus 单例在 service 引用变化时自动重连）。
   - 组件不感知 IndexedDB 细节，只调 `CredentialStore` 接口。

### 4. Demo 包 `packages/local-demo`

- Vite + React 纯静态 SPA，workspace 新包 `rem-agent-local-demo`，不用 Next。
- 结构：
  ```
  packages/local-demo/
    index.html
    vite.config.ts        # alias 排除 pi-ai Node-only 依赖
    src/
      main.tsx
      app.tsx             # <RemLocalApp tools={[...demoTools]} />
      demo-tools.ts       # 1-2 个自定义纯 JS 工具（如计算器、web fetch）
  ```
- 唯一职责：引入 `<RemLocalApp />` + 演示自定义工具注入。
- `pnpm --filter rem-agent-local-demo dev` 起 Vite dev server；`build` 产物可丢任意静态托管。

### 5. 错误处理

- LLM 调用失败（key 错误/CORS/网络）：复用现有 `session-error` bus 事件链渲染；`RemLocalApp` 额外处理"未配置凭据"（进设置面板）与"provider 不支持浏览器直连"（设置面板内联提示）。
- IndexedDB 打开失败（隐私模式等）：`IndexedDBStorageProvider` 降级内存实现并 `console.warn`，不阻断使用。
- `LocalAgentService.init()` 失败：RemLocalApp 显示错误页 + 重试按钮。

### 6. 测试与验证

- **单元测试**（vitest，沿各包 tests/ 惯例）：
  - core：注入 `runtime` 后 `runAgent` 不触碰 `process.*`（`vi.stubGlobal` 验证）；`globalThis.crypto.randomUUID` 路径；模板内联后 assemble 正常。
  - `IndexedDBStorageProvider`：用 `fake-indexeddb` 跑全套 CRUD + searchSessions，用例镜像现有 Sqlite 实现测试。
  - `LocalAgentService`：mock models 跑 run/interrupt/会话 CRUD/stream。
  - UI：RemApp/RemChat 传 mock service 渲染；RemLocalApp 未配置凭据显示设置面板。
- **集成验证**：`pnpm typecheck && pnpm test` 全绿（Node 零回归）；web remote demo 手动回归（会话/发送/rename/pin/搜索/workspace）。
- **local-demo 手动验证**：填 key → 对话 → 刷新会话仍在 → 自定义工具被调用 → 改 key 重建正常。
- **浏览器冒烟**（可选）：agent-browser 跑"配置 key → 发消息 → 刷新 → 会话仍在"。

## 范围外（YAGNI）

- OPFS/LightningFS 浏览器文件工具、exec 替代：不做，工具集默认空。
- Deno/edge 适配：本设计顺带受益但不验证。
- SSE codec 复用：local 模式跳过 SSE，直接用内存 AsyncIterable。
- service worker / 离线缓存：不做。
