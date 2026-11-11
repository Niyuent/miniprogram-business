# 商盟代金券积分系统 · AI 上下文（会话恢复用）

> **用途**：当 AI 会话上下文丢失时，先读本文件恢复项目状态，再开始工作。
> 最后更新：2026-10-10（S4 收口完成）。

---

## 1. 项目定位

微信小程序生态下的**商家联盟积分 / 代金券管理平台**。

- **主体商家（平台方）**：创建所有券、审核附属、配置积分规则。
- **附属商家**：默认只能核销；被授权后可发放主体券。
- **用户（C 端）**：消费得积分 → 积分兑券 → 到店核销。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS 10 + Prisma 5 + MySQL 8（`server/`） |
| 前端 | Vue3 + Vite 6 + Element Plus + Vant + Pinia + vue-router（`web/`） |
| 图表 | ECharts 5（**按需引入**，见 `web/src/views/common/EChart.vue`） |
| 部署 | Docker Compose（gateway(nginx:80) / server:3000 / mysql:3306） |
| 工作目录 | **`D:\shangmeng`（唯一）** —— 不要碰 `D:\My game\商盟系统` |

## 3. 目录结构索引

```
server/src/modules/   auth · merchant · store · authorization · audit-log
                      coupon · point · order · purchase · settlement
                      report · dashboard(在 report 模块) · notification(S5.4-A 站内信后端) · sse · upload
server/prisma/        schema.prisma · migrations/ · seed.ts（固定主键，重跑稳定）
web/src/api/          各模块 API 封装（真实 /api/v1/*，无 mock）
web/src/views/main/   后台页（coupons/orders/points/purchases/settlements/reports/…）
web/src/views/h5/     C 端 H5（exchange / point-logs）
docs/                 00-AI-Context(本文件) · 01~06 · archive/test-scripts/ · screenshots/
```

## 4. 角色与权限模型

- 鉴权主体：`admin_users`（后台账号）+ `roles` + `permissions` + `role_permissions` + `admin_user_roles`。
- 数据主体：`users`（C 端用户，积分/券归属）——**与 admin_users 无鉴权关系**。
- 角色：`PLATFORM_ADMIN` / `MAIN_ADMIN` / `SUB_ADMIN` / `SUB_ADMIN_BASIC` / `STORE_CLERK`。
- 数据隔离：所有涉及商家数据的接口必须走 **S1 的 scope 机制**（`scope()` / merchantId·storeId 由 JWT 推导，**不信任前端传参**）。
- 权限双保险：前端路由 `meta.permission` + `v-permission`；后端 `@Permissions()`（JwtAuthGuard + RolesGuard）。

## 5. 已完成阶段（S0–S4）

| 阶段 | 内容 | 状态 |
|---|---|---|
| S0 | 脚手架 + Docker | ✅ |
| S1 | 商家与权限（登录/JWT/RBAC/入驻/授权/审计） | ✅ |
| S2 | 代金券（模板/券码/发放/核销/冲正） | ✅ |
| S3 | 积分与订单（账户/FIFO/兑换/过期/异常） | ✅ |
| S4.1 | 采购记录 | ✅ 16/0 |
| S4.2 | 对账账单（后端+前端） | ✅ 18/0 |
| S4.3.1 | 报表中心后端（6 报表 + dashboard + CSV） | ✅ 30/0 + 隔离 4/4 |
| S4.3.2.1 | 6 报表前端页 | ✅ |
| S4.3.3 | 工作台图表（ECharts） | ✅ |

## 6. 当前进度 & 下一步

- **当前**：**S0–S7 与 AI 辅助已完成**。S8 微信支付因商户资质审核暂缓。当前阶段是 S9 上线准备（Mock 标记、演示种子、秒杀压测、文档对齐）。
- **回归入口**：`npm run regression`（seed 一次 → 顺序跑全部阶段脚本，失败即停）。
- **S6-A 已完成（技术债 + 联调）**：① 测试脚本交叉脏数据三层治理（回归前置/收尾各 seed 一次 + tmp-s31 自清理 + `npm run db:reset`）；② 补 `tmp-s43-cases.mjs`（S4.3 报表 26/0，是最后一块空白）；③ E2E 主链路 12 张截图跑通（券码→用户→门店→抵扣→对账单金额全对得上）。全量回归 **339/0**。
- **回归脚本总数**：15 个（S1/S2/S3.1–S3.4/S4.1/S4.2/S4.3/S5.1–S5.3/S5.4-A/B1/B2）。
- **S7 SSE 已落地（2026-10-18）**：`notification:new` 实时推送，铃铛**移除 60s 轮询**改为长连接（指数退避重连）；`SseTarget` 新增 `storeId` 维度（门店级只推该店店员 + 商家管理员）；修了 S1 的 `GET /sse/notifications` 缺 `@Public()` 导致 401 的缺陷。回归 **355/0**（16 个脚本）。
- **下一步**：S8 微信支付（资质未齐前不启动）。材料清单见 `docs/09-S8支付资质材料清单.md`。S9 打磨见 `docs/08-快速启动指南.md`。
- **S5.4-B2 前端已收官**（第 3 步通知中心页 ✅ / 第 5 步发布弹窗 ✅ / 第 6 步铃铛 ✅）；S5.4 剩余：SSE（S7）。
- **S5.5 附属侧页面补齐** ✅ **收官**：S5.5-1（`/sub/notifications` 纯收件箱 + `/sub/orders` 本店订单）、S5.5-2（`/sub/purchases` 本店采购 + `/sub/settlements` 本店对账）。
- **S5.5-2 要点**：采购只读（结算权归主体，路由权限码 `settlement:view`→`purchase:view`）；对对账 `GENERATED` 可确认/提异议（`v-permission="'settlement:confirm'"`），`CONFIRMED`/`DISPUTED` 只读；**详情抽屉操作条必须放 `el-drawer` 的 `#footer` 插槽**（放内容流末尾会被明细表格遮挡、按钮点不到）。
- **S5.5-1 要点**：收件箱抽为共用组件 `components/NotificationInbox.vue`（主端/附属共用，`defineExpose({reload})` 供铃铛触发刷新；组件自身已读操作不 bump `readStateVersion`，避免父页重复请求）；附属订单复用 `GET /orders` + `PATCH /orders/:id/abnormal`，手机号前端脱敏（`maskPhone()`），优惠额用「原价−实付」推算（列表接口无 discountAmount）；前端从不传 merchant_id/store_id。
- **S5.4-B2 第 6 步要点**：`NotificationBell.vue` 徽标（>99 显示 99+）+ Popover（最近 5 条未读 / 全部已读 / 查看全部 / 空态）；未读数只读 `stores/notification.ts`；60s 轮询 + visibility 守卫 + onUnmounted 清理 + 失败静默；`TODO(sse)` 已标注。跨组件同步用 store 的 `readStateVersion`（铃铛已读 → 通知中心页重拉）；`/dashboard` 待办未读数也改读 store。
- **S5.4-B2 第 5 步要点**：`NotificationSendDialog.vue` 四选一目标 + 联动多选（门店按商家分组）+ 每次打开重拉 targets；提交成功 → toast + 关窗 + 刷当前 Tab + 同步未读数；脏表单关闭需确认。**后端 `targetType` 是单数 `MERCHANT/STORE`**（不是 MERCHANTS/STORES）。
- **回归入口**：`npm run regression`（seed 一次 → 顺序跑全部阶段脚本，失败即停；含 S5.1/S5.2/S5.3/S5.4-A/S5.4-B1/S5.4-B2，共 313 条）。
- **下一步**：S8 微信支付（资质未齐前不启动）。不在 S9 里实现支付。

## 7. 关键约定（必须遵守）

1. 改动只针对 `D:\shangmeng`；不要碰 `D:\My game\商盟系统`。
2. 每次改动跑：`vue-tsc --noEmit`（前端，`cd web`）、`nest build`（后端，`npm run build -w server`）。
3. 数据隔离：走 S1 scope，不信任前端传参。
4. 权限：路由 `meta.permission` + `v-permission` 双保险。
5. 无 mock：前端真实调 `/api/v1/*`（gateway :80），DevTools Network 可证。
6. 每完成一批停下等验收，不要一口气做完。
7. 捕获唯一键冲突（P2002）**必须精确匹配约束名**，禁止「泛化 P2002 → 具体业务错误」（S4 收口教训，见 docs/06「S4 收口反思」）。

## 8. 运行 / 部署 / 验收命令

```powershell
# 起服务（首次或改了源码后）
docker compose up -d --build server gateway          # 后端/前端改动后重建镜像
docker compose exec server npm run prisma:seed       # 重置演示数据（固定主键）
docker compose exec server npx prisma migrate deploy --schema server/prisma/schema.prisma  # 应用迁移

# 质量门
cd web; npx vue-tsc --noEmit; npx vite build
npm run build -w server

# 回归（seed 一次 → 顺序执行，任一失败即停）
#   S3.2 → S3.1 → S3.3 → S3.4 → S4.1 → S4.2
node docs/archive/test-scripts/tmp-s32-cases.mjs   # …… 依次
```

- **演示账号**（密码均 `Test@123456`）：`admin`(主体) / `sub01`(已授权附属) / `sub02`(未授权附属) / `clerk01`(店员) / `platform`(平台)。
- **稳定主键**：merchant 1/2/3/4；store 101/102/201；admin 1/2/3/4/5；user 1001/1002；模板 1001/1002/1003/2001/1004。
- **验收脚本**：`docs/archive/test-scripts/tmp-s3x/s4x-cases.mjs`；证据 `docs/screenshots/*`。

## 9. C 端鉴权现状（S5.1 已实现）

- **结论：C 端已引入独立登录**（S5.1，2026-10-10）。
- `users` 表仍是**业务主体**（积分账户 / 券实例 / 订单归属）；`admin_users` 是后台鉴权主体。**鉴权已分开**：
  - 后台令牌：`POST /auth/login`，载荷含 `sub`=adminUser.id（无 `kind`）。
  - C 端令牌：`POST /auth/user-login`（微信 code2session），载荷 `kind:'USER'` + `userId`=users.id。
- **双向隔离**：后台接口（全局 `JwtAuthGuard`）拒绝 `kind:'USER'` 令牌；C 端接口 `/h5/**`（`UserJwtAuthGuard`）拒绝后台令牌。
- C 端接口（`/api/v1/h5/**`）一律以**令牌 userId** 为准；`POST /h5/exchange` 若带 `userId` 且与令牌不符 → 403。
- 前端：`utils/h5Request.ts`（`userToken`）+ `api/h5.ts` + `views/h5/login.vue`；`/h5/**` 路由守卫改用 `userToken`（与后台登录态解耦）。
- 开发/模拟：由 `WX_MODE` 显式控制（默认 `real`）；`mock` 仅非生产 + 回环/内网 IP 生效，生产缺 APPID/SECRET 拒绝启动；`/auth/user-login` 同 IP 20 次/分钟限流。
- storage key：后台 `admin_token`、C 端 `user_token`（显式分离）。
- `users.openid/unionid` 已存在（`0_init`），unionid 为 S8「支付即积分」铺路。

## 10. S5 进度与清单

S5 范围（4 批，每批停下验收）：
- **S5.1 C 端用户鉴权** ✅（微信 code2session + C 端 JWT + 双向隔离 + P0 限流/模拟安全）。
- **S5.2 用户管理（主体后台）** ✅（`/main/users` 列表 / 详情 / 启停 / 绑手机号；附属/店员按「本店消费过」隔离）。
- **S5.3 门店变更申请** ✅（`/sub/store` 提交 → `/main/store-change-requests` 审核 → 同事务生效；白名单字段 + 同店 PENDING 唯一 + 驳回必填原因 + 越权 403/状态机 409）。
- **S5.4 通知 + 附属侧补齐** 🔶（B1 每人各自已读/发送批次 ✅、B2 星系视图 ✅、B2 通知中心页 `/main/notifications` ✅（20/0）；剩余：发布弹窗、铃铛、SSE、`/sub/*` 页面）。
- **S5.4-B2 通知中心要点**：`el-tabs` 收件箱/发件箱 + URL `?tab=inbox|sent` 同步（replace + 监听 query）；`NotificationBell.vue` 空占位已挂 `AdminLayout` header-right；新增 `GET /notifications/sent/:sendBatchId`（某批收件人，仅本人批次）；路由权限 `notification:manage` → `notification:view`。
- **S5.4-B2 修复**：`markRead` 的 `alreadyRead: count === 0` 语义颠倒（首标 false / 重标 true）→ 改为直接返回 `withReadState(row)`。

**S5 起点必做（S4 收口遗留）**
1. ✅ C 端 `users` 与后台 `admin_users` 鉴权关系已明确（见第 9 节）。
2. ✅ S1 / S2 回归脚本已补（`tmp-s1-cases.mjs` / `tmp-s2-cases.mjs`）；⬜ **S4.3 报表回归脚本仍缺**（S5 内补）。
3. ✅ `/main/users` 已从占位替换为 S5.2 真实页。

**待认领池（S5.4 / S6 备选）**：需先有「按手机号录单」入口；未匹配手机号进池，用户绑定/注册后按 `users.phone` 自动认领。

## 11. 已知遗留 / 待办

- S4 收口已修：`originBatchId` 唯一键冲突、`ensureAccount` 并发竞态 + P2002 精确化、`toCsv` 全字段加引号、S3.3 边界用例稳健性、S3.4/S3.1 回归脚本。
- 待补：S4.3 报表回归脚本（S5.1/S5.2 已并入 `npm run regression`；S1/S2 已补）。
- 前端 S4.3.2.1 / S4.3.3 的浏览器视觉截图 + Network 截图（人工验收补）。
- 迁移注意：本项目迁移文件与 DB 曾出现 drift，改 schema 优先写迁移而非 `migrate dev`。

## 12. S5.3 前置答复（3 个遗漏）

1. **手机号绑定**
   - **S5.2 已加**：`POST /users/:id/bind-phone`（主体后台，权限 `user:edit`；手机号全局唯一，重复 → 409 `USER_PHONE_EXISTS`，写审计 `user:bind-phone`）。前端在 `/main/users` 列表与详情均有「绑手机号」入口。
   - **录单匹配路径**：当前**录单以 `userId` 为准**（`point:earn` 传 userId），**不存在「手机号匹配不到用户」的场景** —— 因为录单根本不按手机号匹配。
   - **待认领池**：**无**（未实现）。「按手机号录单 → 未匹配进待认领池 → 用户绑定/注册后按 `users.phone` 自动认领」依赖新的录单入口，**S5.4 补上**（先加「按手机号录单」再引入 `pending_records` 池）。

2. **C 端 user token 有效期**
   - 时长：**2h**（与环境变量 `JWT_EXPIRES_IN` 一致，与 admin token 同值）。
   - refresh：**无**。过期后 `h5Request` 拦截 401 → 清 `user_token` → 跳 `/h5/login`，用户重新 `wx.login`（微信**静默重新登录**，成本极低）。
   - 与 admin token 的区别：payload 不同（C 端 `kind:'USER' + userId`；后台 `sub`=adminUser.id 无 `kind`）、可访问范围不同（C 端仅 `/h5/**`；后台为 `/api/v1/**` 其余）、存储 key 不同（`user_token` vs `admin_token`）、签发端点不同（`/auth/user-login` vs `/auth/login`）。

3. **`npm run regression` 入口**
   - **已加入** S5.1 / S5.2 脚本（`scripts/regression.mjs`：seed 一次 → 顺序跑 S1/S2/S3.1–S3.4/S4.1/S4.2/S5.1/S5.2，任一失败即停）。
   - 最近一次全量回归 = **204/0**（23+12+32+39+15+20+16+18+14+15）。S5.3 完成后脚本并入，回归总数将增至 204 + S5.3 用例数。
