# 消除 Next.js 服务端动态导入警告

## 背景

Web 应用在编译 API 路由时，Webpack 会报告 `Critical dependency: the request of a dependency is an expression`。导入链来自 `@earendil-works/pi-ai/dist/auth/context.js`，并且 `awilix` 也会产生同类警告。

`pi-ai` 使用变量形式的动态 `import()` 来按需访问 Node 内置模块（`node:fs/promises` 和 `node:os`）。这种实现可避免浏览器环境解析 Node 模块，但 Webpack 无法在构建期确定模块名。导入链是警告的来源说明，不是运行时异常：页面、SSE 和会话 API 均能成功响应。

## 目标与非目标

目标是在不改变 Agent、Provider 或浏览器端行为的前提下，消除这两项服务端编译警告。

本次不修改 `pi-ai`、不添加 Webpack 的全局忽略规则、不拆分 Core 导出，也不改变 Provider 配置归属。

## 方案

仅修改 `packages/web/next.config.ts` 的 `serverExternalPackages`：保留已有的工作区包和 `better-sqlite3`，并加入 `@earendil-works/pi-ai` 与 `awilix`。

这会让 Next.js 服务器构建把这两个依赖保留为 Node.js 运行时模块，而不是交给 Webpack 解析其内部的表达式动态导入。API 路由继续通过 `rem-agent-core` 和 `rem-agent-bridge` 使用它们；客户端 bundle 不会包含这些依赖。

## 验证

1. 运行 Web 开发服务器并访问首页，触发 `/api/workspaces` 与 `/api/agent/stream`。
2. 检查构建日志：不再出现 `pi-ai/dist/auth/context.js` 或 `awilix.module.mjs` 的 `Critical dependency` 警告。
3. 用浏览器确认页面可加载、工作区 API 返回 200、SSE 连接为 200。
4. 运行仓库类型检查；本改动仅为 Next 配置，若全仓已有无关失败，单独报告。
