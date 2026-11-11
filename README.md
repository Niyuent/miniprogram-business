# 商盟系统 · 完整可运行项目

一个仓库包含三块代码，克隆后即可启动：

| 目录 | 作用 | 技术栈 |
| --- | --- | --- |
| `server/` | 后端 API：积分、券、联盟、商家互清分、登录 | NestJS + Prisma + MySQL 8 |
| `web/` | 平台 / 商家管理后台 | Vue3 + Vite + Element Plus |
| `web-mini/` | 会员端 + 商家端小程序 | uni-app（Vue3 + Vite + TypeScript） |

`deploy/` 是网关 Nginx 配置与镜像；根 `docker-compose.yml` 编排 MySQL、后端、网关（网关内含管理后台静态资源）。

---

## 一、最快：Docker Compose 一键启动

需要 Docker Desktop（Compose v2），且 80 / 3306 端口未被占用。

```bash
cp .env.example .env
docker compose up -d --build          # mysql -> server -> gateway
```

| 入口 | 地址 |
| --- | --- |
| 管理后台 | http://localhost |
| 后端健康检查 | http://localhost/api/v1/health |
| Swagger | http://localhost/api/docs |

后端容器启动命令里已有 `npx prisma migrate deploy`，会自动建表。首次灌演示数据：

```bash
docker compose exec -T server npm run prisma:seed
```

> `.env.example` 里的口令是**仅本地开发用的默认值**。公网部署前必须修改 `MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD`、`JWT_SECRET`、`API_TOKEN`，并让 `DATABASE_URL` 中的密码与 `MYSQL_PASSWORD` 保持一致。`.env` 已被 `.gitignore` 排除，请勿提交。

---

## 二、本地开发（改代码用）

```bash
# 1. 只起数据库（后端仍在本机跑）
cp .env.example .env
docker compose up -d mysql

# 2. 安装 server + web 的依赖（npm workspaces）
npm install

# 3. 本地环境变量
cp server/.env.example server/.env
cp web/.env.example web/.env.development.local

# 4. 建库建表 + 演示数据
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed

# 5. 起服务（两个终端）
npm run dev:server                   # http://localhost:3000
npm run dev:web                      # http://localhost:5173
```

管理后台通过 Vite 代理把 `/api/v1` 转发到 `http://127.0.0.1:3000`。只想看前端界面时，把 `VITE_USE_MOCK` 改成 `true` 即可不依赖后端。

---

## 三、小程序

小程序不在根 workspaces 里，需要单独安装依赖：

```bash
cd web-mini
npm install
npm run dev:mp-weixin                # 产物 dist/dev/mp-weixin，改代码实时更新
npm run build:mp-weixin              # 产物 dist/build/mp-weixin，用于上传发布
npm run dev:h5 -- --port 5175         # 浏览器预览 H5
```

- 用微信开发者工具导入 `web-mini/dist/build/mp-weixin`。注意 `web-mini/project.config.json` 的 `miniprogramRoot` 默认指向 `dist/dev/mp-weixin/`，导入 build 包时把它改成 `dist/build/mp-weixin/`。
- `web-mini/src/manifest.json` 的 `appid` 要换成你自己的小程序 AppID。
- 接口地址：开发态默认直连 `http://127.0.0.1:3000`；走 80 网关时把 `web-mini/.env` 的 `VITE_API_PORT` 置空；发布时填 `VITE_API_ORIGIN=https://你的域名`，并在微信公众平台配置为合法域名。
- 登录采用**手机号统一登录**，商家与会员可切换。dev 构建带商家测试账号，build 构建不含；**短信验证码尚未接入**，正式上线前必须补齐。

---

## 四、端口一览

| 端口 | 用途 |
| --- | --- |
| 80 | 网关（管理后台 + 后端 API 反代） |
| 3000 | 后端直连（本地开发） |
| 3306 | MySQL |
| 5173 | 管理后台 Vite |
| 5175 | 小程序 H5 预览 |
| 8765 | Laya 决策模型（可选，挂了不影响启动） |

更多细节见 `docs/08-快速启动指南.md`、`docs/05-部署手册.md`、`docs/03-API接口.md`。
