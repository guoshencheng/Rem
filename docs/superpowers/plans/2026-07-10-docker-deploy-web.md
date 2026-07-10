# Docker 部署 rem-agent-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `packages/web` 添加 Docker 化部署能力，使其能在 `192.168.31.51` 上通过 docker-compose 运行。

**Architecture:** 采用全 workspace 多阶段构建：先用 pnpm 安装并构建 `rem-agent-core`、`rem-agent-bridge`、`rem-agent-web`，再生成仅含运行产物的最终镜像；通过 `docker-compose` 映射端口并挂载 `.rem-agent` 和 `/data` 数据卷。

**Tech Stack:** Docker、docker-compose 1.29.2、pnpm 11.x、Next.js 15、Node.js 20

---

## File Structure

- `packages/web/Dockerfile` — 多阶段构建镜像
- `packages/web/docker-compose.yml` — 服务编排、端口映射、volume 挂载、环境变量
- `packages/web/.env.example` — 部署环境变量示例
- `packages/web/.gitignore` — 增加 `data/` 目录忽略

---

### Task 1: 创建 Dockerfile

**Files:**
- Create: `packages/web/Dockerfile`

- [ ] **Step 1: 创建多阶段 Dockerfile**

```dockerfile
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS builder
WORKDIR /app
COPY packages/core ./packages/core
COPY packages/bridge ./packages/bridge
COPY packages/web ./packages/web
RUN pnpm --filter rem-agent-core build
RUN pnpm --filter rem-agent-bridge build
RUN pnpm --filter rem-agent-web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/web/.next ./.next
COPY --from=builder /app/packages/web/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/bridge ./packages/bridge
EXPOSE 3000
CMD ["pnpm", "next", "start", "--port", "3000"]
```

- [ ] **Step 2: 验证 Dockerfile 语法**

从仓库根目录执行：

```bash
docker build -f packages/web/Dockerfile -t rem-agent-web:deps --target=deps .
```

Expected: 成功构建到 `deps` 阶段，无错误输出。

- [ ] **Step 3: Commit**

```bash
git add packages/web/Dockerfile
git commit -m "feat(web): add Dockerfile for Docker deployment"
```

---

### Task 2: 创建 docker-compose.yml

**Files:**
- Create: `packages/web/docker-compose.yml`

- [ ] **Step 1: 创建 docker-compose 文件**

```yaml
version: "3.7"

services:
  web:
    build:
      context: ${COMPOSE_BUILD_CONTEXT:-../..}
      dockerfile: ${COMPOSE_DOCKERFILE:-packages/web/Dockerfile}
    container_name: ${WEB_CONTAINER_NAME:-rem-agent-web}
    image: ${WEB_IMAGE_NAME:-rem-agent-web:latest}
    ports:
      - "${WEB_HOST_PORT:-3000}:3000"
    env_file:
      - ${WEB_ENV_FILE:-.env}
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - REM_AGENT_WORKSPACES_FILE=${REM_AGENT_WORKSPACES_FILE:-}
    volumes:
      - ${REM_AGENT_DATA_DIR:-./.rem-agent}:/app/packages/web/.rem-agent
      - ${USER_DATA_DIR:-./data}:/data
    restart: ${WEB_RESTART_POLICY:-unless-stopped}
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/', r=>process.exit(r.statusCode==200?0:1)).on('error',()=>process.exit(1))"]
      interval: ${WEB_HEALTH_INTERVAL:-30s}
      timeout: ${WEB_HEALTH_TIMEOUT:-5s}
      retries: ${WEB_HEALTH_RETRIES:-3}
```

- [ ] **Step 2: 验证 compose 文件语法**

从 `packages/web` 目录执行：

```bash
cd packages/web
docker-compose config
```

Expected: 输出解析后的配置，无错误。由于 `.env` 不存在，变量会使用默认值。

- [ ] **Step 3: Commit**

```bash
git add packages/web/docker-compose.yml
git commit -m "feat(web): add docker-compose for deployment"
```

---

### Task 3: 创建 .env.example

**Files:**
- Create: `packages/web/.env.example`

- [ ] **Step 1: 创建环境变量示例文件**

```text
# 容器外部访问端口
WEB_HOST_PORT=3000

# 容器名
WEB_CONTAINER_NAME=rem-agent-web

# rem-agent session 数据目录
REM_AGENT_DATA_DIR=./.rem-agent

# 用户自定义数据目录，容器内挂载到 /data
USER_DATA_DIR=./data

# LLM 配置（由 rem-agent-core 读取）
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.minimaxi.com/v1
OPENAI_MODEL=MiniMax-M3

# 运行环境
NODE_ENV=production
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/.env.example
git commit -m "chore(web): add deployment env example"
```

---

### Task 4: 更新 .gitignore

**Files:**
- Modify: `packages/web/.gitignore`

- [ ] **Step 1: 增加 `data/` 目录忽略**

在 `packages/web/.gitignore` 末尾添加一行：

```text
data/
```

修改后文件内容：

```text
.env
.env.local
.next/
next-env.d.ts
.rem-agent/
data/
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/.gitignore
git commit -m "chore(web): ignore data directory used for Docker deployment"
```

---

### Task 5: 本地构建完整镜像

**Files:**
- None

- [ ] **Step 1: 执行完整构建**

从仓库根目录执行：

```bash
docker build -f packages/web/Dockerfile -t rem-agent-web:test .
```

Expected: 构建成功，最终阶段 `runner` 生成镜像 `rem-agent-web:test`。

- [ ] **Step 2: 启动本地容器验证**

```bash
docker run -d --name rem-agent-web-local \
  -p 3000:3000 \
  -e OPENAI_API_KEY=sk-test \
  -e OPENAI_BASE_URL=https://api.minimaxi.com/v1 \
  -e OPENAI_MODEL=MiniMax-M3 \
  rem-agent-web:test
```

等待约 5 秒后执行：

```bash
curl -f http://localhost:3000
```

Expected: 返回 200 或 Next.js 页面 HTML。

- [ ] **Step 3: 清理本地容器**

```bash
docker stop rem-agent-web-local
docker rm rem-agent-web-local
```

---

### Task 6: 在服务器 192.168.31.51 上部署

**Files:**
- None

- [ ] **Step 1: 在服务器上拉取最新代码**

```bash
ssh guoshencheng@192.168.31.51
# 假设仓库已克隆到 ~/rem
cd ~/rem
git pull
```

Expected: 代码更新到包含 Dockerfile 和 docker-compose.yml 的最新 commit。

- [ ] **Step 2: 创建并配置 .env**

```bash
cd ~/rem/packages/web
cp .env.example .env
# 编辑 .env，填入真实的 OPENAI_API_KEY
nano .env
```

- [ ] **Step 3: 启动容器**

```bash
docker-compose down
docker-compose up --build -d
```

Expected:
- 镜像构建成功
- 容器 `rem-agent-web` 启动
- 端口 3000 被监听

- [ ] **Step 4: 验证服务可用**

```bash
curl -f http://192.168.31.51:3000
```

Expected: 返回 200 或页面 HTML。

- [ ] **Step 5: 验证 session 持久化**

1. 打开浏览器访问 `http://192.168.31.51:3000`
2. 创建一个 session 并发送一条消息
3. 执行 `docker-compose restart`
4. 刷新页面，确认 session 列表仍在

Expected: session 和对话记录未丢失。

- [ ] **Step 6: 查看日志**

```bash
docker-compose logs -f
```

确认无启动错误。

---

## Self-Review

- **Spec coverage:**
  - 服务器本地构建 ✅ Task 1, 5, 6
  - Docker + docker-compose 1.29.2 兼容 ✅ Task 1, 2
  - 端口 3000 映射 ✅ Task 2
  - .rem-agent 数据持久化 ✅ Task 2, 6
  - /data 用户自定义挂载 ✅ Task 2, 4, 6
  - 环境变量可配置 ✅ Task 2, 3, 6
  - 无反向代理/HTTPS ✅ 设计本身不涉及
- **Placeholder scan:** 无 TBD/TODO，每个步骤包含具体命令和代码。
- **Type consistency:** 环境变量名称与 docker-compose 文件一致，Dockerfile 路径与 compose 中配置一致。

