# Docker 部署 rem-agent-web 设计

## 背景

`packages/web` 当前是 Next.js 15 应用，仅通过 `pnpm dev`/`pnpm build`/`pnpm start` 在本地运行，没有现成的部署配置。目标是把 web 服务通过 Docker 部署到局域网服务器 `192.168.31.51`，供内网访问。

## 目标

- 在 `192.168.31.51` 上以 Docker 容器方式运行 `rem-agent-web`。
- 通过 `http://192.168.31.51:3000` 访问。
- session 数据在容器重建后不丢失。
- 支持用户自定义数据目录 `/data` 挂载。
- 构建在服务器本地完成，无需镜像仓库。

## 约束

- 目标服务器：Ubuntu 24.04，Docker 29.1.3，docker-compose 1.29.2（Python 旧版）。
- 不配置反向代理、不启用 HTTPS。
- 端口由服务器可用端口决定，当前 3000 可用。
- 项目是 pnpm monorepo，`rem-agent-web` 依赖 `rem-agent-core` 和 `rem-agent-bridge`。

## 可选方案

### 方案 1：全 workspace 容器化（推荐）

在服务器上拉取完整 monorepo，安装 workspace 依赖并构建全部相关包，最后启动 `next start`。

优点：
- 最符合当前 monorepo 结构，workspace 依赖处理自然。
- 构建失败容易排查，调试方便。
- 复用现有 `pnpm` 工作流。

缺点：
- 镜像体积较大。
- 构建时间稍长。

### 方案 2：Standalone 输出优化

配置 `next.config.ts` 为 `output: 'standalone'`，使用多阶段 Dockerfile 仅复制运行产物和最小依赖。

优点：
- 镜像更小，启动更快。

缺点：
- monorepo workspace 包（`rem-agent-core`、`rem-agent-bridge`）需显式处理，容易遗漏。
- 需要额外验证 Next.js standalone 对 workspace 依赖的复制行为。

### 方案 3：直接 `docker run`

不写 docker-compose，只提供 Dockerfile 和启动脚本。

优点：
- 文件最少。

缺点：
- 重启、环境变量、volume 挂载都需手动维护。
- 后续扩展（如加 sidecar、健康检查）不方便。

## 推荐方案

采用**方案 1：全 workspace 容器化**。当前阶段以稳定可靠优先，先跑通部署，再考虑镜像优化。

## 详细设计

### 1. 文件位置

```text
packages/web/
├── Dockerfile
├── docker-compose.yml
└── .env              # 由用户放置，不提交到仓库
```

### 2. Dockerfile

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

说明：
- `node:20-slim` 减少镜像体积。
- 使用 corepack 安装 pnpm，版本与仓库保持一致。
- 先复制 package.json 并 `pnpm install`，再复制源码，最大化利用 Docker 构建缓存。
- 构建阶段依次构建 `core`、`bridge`、`web`。
- 运行阶段仅保留产物、package.json 和必要 node_modules。

### 3. docker-compose.yml

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
      test: ["CMD", "curl", "-f", "http://localhost:3000"]
      interval: ${WEB_HEALTH_INTERVAL:-30s}
      timeout: ${WEB_HEALTH_TIMEOUT:-5s}
      retries: ${WEB_HEALTH_RETRIES:-3}
```

说明：
- 所有关键路径、端口、容器名均通过环境变量配置，避免写死。
- `version: "3.7"` 兼容服务器上的 docker-compose 1.29.2。
- 挂载两个 volume：
  - `.rem-agent`：持久化 session 和 workspace 元数据。
  - `/data`：用户自定义数据目录，容器内外打通。

### 4. 环境变量

服务器上 `packages/web/.env` 示例：

```bash
# 容器外部访问端口
WEB_HOST_PORT=3000

# 容器名
WEB_CONTAINER_NAME=rem-agent-web

# rem-agent session 数据目录
REM_AGENT_DATA_DIR=./.rem-agent

# 用户自定义数据目录，容器内挂载到 /data
USER_DATA_DIR=./data

# LLM 配置（由 rem-agent-core 读取，非 web 直接读取）
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.minimaxi.com/v1
OPENAI_MODEL=MiniMax-M3

# 运行环境
NODE_ENV=production
```

说明：
- `OPENAI_API_KEY` 等 Provider 配置由 `rem-agent-core` 解析，符合项目红线。
- `.env` 文件通过安全方式（如 `scp`）放到服务器，不进入 Git 仓库。
- `web/.gitignore` 已忽略 `.env`。

### 5. 数据持久化

- `REM_AGENT_DATA_DIR` 指向的目录会挂载到容器内的 `/app/packages/web/.rem-agent`。
- 该目录包含 `sessions/`、`workspaces.json`、`permissions.json` 等，容器重建后保留。
- 建议首次部署前在服务器上创建该目录并确认权限：`mkdir -p /path/to/.rem-agent`。
- `USER_DATA_DIR` 指向的目录挂载到容器内 `/data`，供用户自行使用（如作为 workspace 根目录）。

### 6. 部署流程

在服务器上执行：

```bash
# 1. 进入项目目录
cd /path/to/rem

# 2. 拉取最新代码
git pull

# 3. 进入 web 包
cd packages/web

# 4. 确保 .env 文件存在且配置正确
#    （手动 scp 或编辑）

# 5. 停止旧容器并重新构建、启动
docker-compose down
docker-compose up --build -d

# 6. 查看日志
docker-compose logs -f
```

### 7. 验证

- 访问 `http://192.168.31.51:3000`，页面应正常加载。
- 检查 healthcheck：
  ```bash
  docker inspect --format='{{.State.Health.Status}}' rem-agent-web
  ```
- 创建一个 session 并发送一条消息，确认 Agent 能正常响应。
- 执行 `docker-compose restart` 后刷新页面，确认 session 数据未丢失。

### 8. 错误处理与回滚

- 构建失败时旧容器继续运行（如果它还存在），新容器不会启动。
- 查看日志定位问题：
  ```bash
  docker-compose logs -f web
  ```
- 回滚：
  ```bash
  git checkout <previous-commit>
  docker-compose up --build -d
  ```
- 若容器异常退出，docker-compose 的 `restart: unless-stopped` 会自动重试。

### 9. 后续优化方向（非本阶段范围）

- 切换到 `output: 'standalone'` 进一步减小镜像体积。
- 增加 CI/CD 脚本，实现 push 后自动部署。
- 增加反向代理和 HTTPS（如果需要公网访问）。
- 使用非 root 用户运行容器。

## 决策记录

- 选择服务器本地构建（B），而非本地构建后推送镜像。
- 不配置反向代理和 HTTPS。
- 使用端口 3000（服务器当前可用）。
- 所有挂载路径、端口、容器名通过环境变量配置，支持用户自定义 `/data` 目录。
