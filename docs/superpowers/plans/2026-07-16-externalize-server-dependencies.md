# Externalize Server Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Next.js 服务端将 pi-ai 与 awilix 保留为 Node.js 运行时依赖，消除 API 路由编译时的动态导入警告。

**Architecture:** 仅调整 Web 层的 Next 配置边界。`serverExternalPackages` 明确列出两个会触发 Webpack 表达式动态导入分析的服务端依赖；Core、Bridge 与 API 路由的导入和运行时行为保持不变。

**Tech Stack:** Next.js 15、Webpack、Node.js、pnpm、agent-browser。

---

## File structure

- Modify: `packages/web/next.config.ts` — Web 服务端的外部依赖边界配置。
- Create: 无。
- Test: 无独立单元测试；用 Web 开发服务器日志与浏览器 API 请求验证构建和运行时行为。

### Task 1: Externalize dynamic-importing server dependencies

**Files:**
- Modify: `packages/web/next.config.ts:4`

- [ ] **Step 1: 记录当前警告的复现基线**

运行：

```bash
pnpm --filter rem-agent-web exec next dev --port 3001
```

在浏览器访问 `http://localhost:3001`，预期服务器日志会在编译 `/api/workspaces` 或 `/api/agent/stream` 时包含：

```text
@earendil-works/pi-ai/dist/auth/context.js
Critical dependency: the request of a dependency is an expression
```

日志还会包含同类的 `awilix/lib/awilix.module.mjs` 警告。停止服务器后继续。

- [ ] **Step 2: 扩充服务端外部包清单**

将 `packages/web/next.config.ts` 中的配置更新为：

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: [
    'rem-agent-core',
    'rem-agent-bridge',
    'better-sqlite3',
    '@earendil-works/pi-ai',
    'awilix',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'better-sqlite3': 'commonjs better-sqlite3',
      });
    }
    return config;
  },
};
```

不添加 `ignoreWarnings`，不更改 Core 或 Bridge 的导入。

- [ ] **Step 3: 检查格式与类型**

运行：

```bash
pnpm --filter rem-agent-web typecheck
```

预期：命令以状态码 0 结束。

- [ ] **Step 4: 验证 Webpack 警告已消失且 API 仍可用**

运行：

```bash
pnpm --filter rem-agent-web exec next dev --port 3001
```

使用 agent-browser 打开 `http://localhost:3001`，等待首页加载。确认以下请求均为 200：

```text
GET /api/workspaces
GET /api/sessions?workspace=<当前工作区路径>
GET /api/agent/stream
```

检查服务器日志不含以下任一文本：

```text
pi-ai/dist/auth/context.js
awilix.module.mjs
Critical dependency: the request of a dependency is an expression
```

停止开发服务器并关闭浏览器会话。

- [ ] **Step 5: 提交配置修复**

运行：

```bash
git add packages/web/next.config.ts
git commit -m "fix(web): externalize server dependencies"
```

预期：提交仅包含 `packages/web/next.config.ts`，不纳入现有 Core 迁移的未提交改动。
