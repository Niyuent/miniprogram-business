# 商盟系统 · 前端镜像（服务名 screen，源码目录仍为 web）
# 构建上下文必须是仓库根目录：
#   docker build -f web/Dockerfile --build-arg VITE_USE_MOCK=false -t shangmeng-screen:latest .
#
# 镜像内自带 Nginx + SPA 配置，可独立运行：
#   docker run --rm -p 8080:80 shangmeng-screen:latest
#   docker compose --profile assets up -d screen   → http://localhost:8080
#
# ⚠️ 不再导出 dist 到共享卷：网关 gateway 镜像自带前端产物（多阶段构建），
#    compose 默认不启动本服务（profiles: [assets]）。

# ------------------------------------------------------------------ 构建阶段
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY web ./web
COPY server/package.json ./server/

RUN npm config set registry https://registry.npmmirror.com
RUN npm ci

# 生产构建期注入的环境变量（运行时不再需要，已打进包）
ARG VITE_USE_MOCK=false
ARG VITE_API_BASE=/api/v1
ARG VITE_PROXY_TARGET=http://server:3000
ENV VITE_USE_MOCK=$VITE_USE_MOCK \
    VITE_API_BASE=$VITE_API_BASE \
    VITE_PROXY_TARGET=$VITE_PROXY_TARGET

RUN npm run build -w web

# ------------------------------------------------------------------ 运行阶段
FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/web/dist /usr/share/nginx/html
# 独立运行时使用的 SPA 配置（网关场景由 deploy/nginx/gateway.conf 提供）
COPY deploy/nginx/screen.conf /etc/nginx/conf.d/default.conf

# nginx 官方镜像以 nginx 用户运行 worker，确保可读可写，避免 403
RUN chown -R nginx:nginx /usr/share/nginx/html /var/log/nginx 2>/dev/null || true

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
