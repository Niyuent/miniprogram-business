# 商盟系统 · 后端服务镜像（多阶段构建）
# 构建上下文必须是仓库根目录：
#   docker build -f server/Dockerfile -t shangmeng-server:latest .
#
# 说明：npm workspaces 单仓，构建阶段安装全部依赖并编译，
#      运行阶段只保留 node_modules(生产) + dist + prisma + tsconfig.json。
#      prisma / ts-node / tsconfig-paths / typescript 必须在 server 的 dependencies，
#      否则 npm prune 后容器内无法执行 migrate deploy 与 db seed。

# ------------------------------------------------------------------ 构建阶段
FROM node:22-alpine AS builder
WORKDIR /app
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
RUN apk add --no-cache openssl

# 先拷贝依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY server ./server
# web 仅需 package.json 用于 workspace 解析（源码不参与后端构建）
COPY web/package.json ./web/

RUN npm config set registry https://registry.npmmirror.com
RUN npm ci
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
RUN npm run prisma:generate -w server
RUN npm run build -w server
# 剔除 devDependencies（保留 prisma CLI 以便容器内执行 migrate deploy）
RUN npm prune --omit=dev

# ------------------------------------------------------------------ 运行阶段
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=3000

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# Prisma 引擎在 musl 上需要 openssl + libc6-compat
RUN apk add --no-cache openssl libc6-compat curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/tsconfig.json ./server/tsconfig.json
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma
# S2.2：seed 直接复用生产券码算法（`src/modules/coupon/coupon-code.util`），
# 保证演示券码与线上发码同源（同样的字符集与校验位），所以运行镜像需要带一份 src。
# 只是源码文本，不参与运行时加载（入口仍是 server/dist/main.js）。
COPY --from=builder /app/server/src ./server/src

# 非 root 运行（node 镜像自带 node 用户）
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health || exit 1

# 启动时先应用数据库迁移，再拉起服务
CMD ["sh", "-c", "npx prisma migrate deploy --schema=server/prisma/schema.prisma && node server/dist/main.js"]
