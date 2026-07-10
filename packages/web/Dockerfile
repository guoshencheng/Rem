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
