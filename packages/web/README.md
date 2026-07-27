# rem-agent-web

Rem Agent 的最小可运行 Demo（Next.js 15 + React 19），演示"Node 后端 + 前端"的标准集成方式：后端 `rem-agent-core` + `rem-agent-routes`，前端 `rem-agent-ui`。

## 运行

```bash
# 配置模型（二选一）：
# 1. 在项目根创建 rem-agent.config.json，参考 docs/integration.md
# 2. 或使用 ~/.rem-agent/config.json

export ANTHROPIC_API_KEY=sk-...   # 或你配置的 provider key

pnpm --filter rem-agent-web dev   # http://localhost:3000
```

## 代码结构

```text
src/
  lib/agent-service.ts              # AgentService 单例（SQLite 持久化）
  app/api/rem/[...path]/route.ts    # createRemHandler 挂载的 HTTP/SSE API
  app/page.tsx                      # <RemApp service={AgentRemoteService} />
  styles/globals.css                # tailwind + rem-agent-ui 样式
```

集成细节与自定义方式见 [docs/integration.md](../../docs/integration.md)。
