# 透明身份规划平台 — API 演示镜像（Render 免费 Web 服务）
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# 先装依赖（利用层缓存）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui-native/package.json packages/ui-native/
COPY services/api/package.json services/api/
COPY apps/admin-web/package.json apps/admin-web/
COPY apps/client-app/package.json apps/client-app/
COPY apps/advisor-app/package.json apps/advisor-app/

RUN pnpm install --frozen-lockfile --registry=https://registry.npmjs.org

# 源码与构建
COPY packages ./packages
COPY services ./services

ARG DATABASE_URL=postgresql://tip:tip@localhost:5432/tip
RUN pnpm --filter @tip/api prisma:generate \
  && pnpm --filter @tip/core build \
  && pnpm --filter @tip/api build

ENV NODE_ENV=production
ENV SHADOW_ENV=true
EXPOSE 3100

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
