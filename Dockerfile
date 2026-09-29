# 公开镜像根 Dockerfile（Render 构建入口；内容与 05-代码/Dockerfile 相同，路径加 05-代码 前缀）
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY 05-代码/pnpm-workspace.yaml 05-代码/package.json 05-代码/pnpm-lock.yaml 05-代码/tsconfig.base.json ./
COPY 05-代码/packages/core/package.json packages/core/
COPY 05-代码/packages/ui-native/package.json packages/ui-native/
COPY 05-代码/services/api/package.json services/api/
COPY 05-代码/apps/admin-web/package.json apps/admin-web/
COPY 05-代码/apps/client-app/package.json apps/client-app/
COPY 05-代码/apps/advisor-app/package.json apps/advisor-app/

RUN pnpm install --frozen-lockfile --registry=https://registry.npmjs.org

COPY 05-代码/packages ./packages
COPY 05-代码/services ./services

ARG DATABASE_URL=postgresql://tip:tip@localhost:5432/tip
RUN pnpm --filter @tip/api prisma:generate \
  && pnpm --filter @tip/core build \
  && pnpm --filter @tip/api build

ENV NODE_ENV=production
ENV SHADOW_ENV=true
EXPOSE 3100

COPY 05-代码/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
