FROM node:22-slim AS base
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

FROM deps AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY tsconfig.json ./
COPY packages/core ./packages/core
RUN pnpm --filter rem-agent-core build
COPY packages/bridge ./packages/bridge
RUN pnpm --filter rem-agent-bridge build
COPY packages/web ./packages/web
RUN pnpm --filter rem-agent-web build
WORKDIR /app/packages/web
EXPOSE 3000
CMD ["pnpm", "next", "start", "--port", "3000"]
