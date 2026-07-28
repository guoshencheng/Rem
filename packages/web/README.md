# rem-agent-web

Rem Agent 的最小可运行 Demo（Hono + Vite + React 19），演示"Node 后端 + 前端"的标准集成方式：后端 `rem-agent-core` + `rem-agent-routes`，前端 `rem-agent-ui`。

## 运行

```bash
# 在项目根配置 rem-agent config.json，参考 docs/integration.md

pnpm --filter rem-agent-web dev   # http://localhost:3000
```

dev 模式下 Vite 在 3000 端口服务前端，Hono API 在 3001 端口，Vite 自动代理 `/api` 到 API server。

## 生产构建

```bash
pnpm --filter rem-agent-web build
pnpm --filter rem-agent-web start   # http://localhost:3000
```

生产模式下 Hono server 同时服务静态文件和 API。

## 代码结构

```text
src/
  main.tsx                          # React 入口
  App.tsx                           # <RemApp service={AgentRemoteService} />
  server.ts                         # Hono API server（dev/prod）
  agent-service.ts                  # AgentService 单例
  styles/index.css                  # tailwind + rem-agent-ui 样式
index.html                          # Vite HTML 入口
vite.config.ts                      # Vite 配置 + dev proxy
```
