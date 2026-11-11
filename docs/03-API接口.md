# 03 · API 接口列表

统一前缀 `/api/v1`；统一响应 `{ code, message, data, traceId }`；分页参数 `page / pageSize / sort`。
所有写操作的敏感变更写入 `audit_logs`。

> 标记含义：**[MAIN]** 仅主体商家 / **[SUB]** 附属商家 / **[SCOPED]** 受 `MerchantScopeGuard` 数据隔离 / **[M]** S0–S5 由前端 mock 提供。

---

## 1. 认证与账号

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/login` | 账号密码登录，返回 token + 角色 + 权限码 + 商家上下文 **[M]** |
| POST | `/auth/user-login` | C 端微信登录（公开）；可选 `inviterCode=U{userId}`，仅新用户首触记录邀请归因 |
| POST | `/auth/logout` | |
| GET | `/auth/profile` | 当前账号信息 **[M]** |
| PUT | `/auth/password` | 修改密码 |
| GET | `/auth/permissions` | 权限码列表 **[M]** |

## 2. 工作台

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dashboard/stats` | 角色差异化卡片数据 **[M]** |
| GET | `/dashboard/trend?days=7` | 订单/核销/兑换趋势 **[M]** |
| GET | `/dashboard/todo` | 待审核商家 / 异常订单 / 未读通知 **[M]** |

## 3. 商家与入驻审核 **[MAIN]**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/merchants` | 列表（type/status/keyword） |
| GET | `/merchants/:id` | 详情（含门店、授权、采购统计） |
| POST | `/merchants` | 后台代建附属商家 |
| PUT | `/merchants/:id` | 基础信息编辑 |
| PATCH | `/merchants/:id/status` | 启用 / 暂停 / 驳回 |
| GET | `/merchants/applications` | 入驻申请列表（含邀请方 inviter） |
| POST | `/merchants/applications` | 公开提交入驻申请（同 IP 3 次/小时）；可选 `inviteCode=SM{merchantId}` 记录邀请归因 |
| POST | `/merchants/applications/:id/approve` | 通过（建账号 + 默认门店） |
| POST | `/merchants/applications/:id/reject` | 驳回（填原因） |
| GET | `/merchants/applications/export` | 导出（前端 CSV） |

## 4. 门店

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/stores` | 列表 **[SCOPED]** |
| GET | `/stores/:id` | 详情 **[SCOPED]** |
| POST / PUT | `/stores` `/stores/:id` | CRUD **[MAIN]** / **[SUB]** 仅本店 |
| PATCH | `/stores/:id/status` | 营业 / 停用 |
| POST | `/stores/:id/change-requests` | 提交信息修改申请 **[SUB]** |
| GET | `/stores/change-requests` | 申请列表（主体审核视角） |
| POST | `/stores/change-requests/:id/review` | 通过 / 驳回 **[MAIN]** |

## 5. 授权管理 **[MAIN]**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/authorizations` | 授权列表 |
| POST | `/authorizations` | 开启授权（subMerchantId + authType + templateScope + templates[]） |
| PATCH | `/authorizations/:id/disable` | 关闭授权 |
| GET | `/authorizations/logs` | 授权记录（报表用） |
| GET | `/authorizations/available-templates` | 可选主体券模板 |

## 6. 代金券

### 6.1 券模板管理（S2.1 已实现）

可见性按身份收敛：**主体商家 = 自己创建的 + 自己拥有的；附属商家 = 自己拥有的 + 授权范围内且已上架的主体券；平台 = 全部**。范围外的模板一律 404（不暴露存在性）。

| 方法 | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | `/coupon-templates` | `coupon:view` | 列表（keyword / ownerType / status / ownerMerchantId，分页） |
| GET | `/coupon-templates/:id` | `coupon:view` | 详情（券码 / 券实例 groupBy 统计） |
| POST | `/coupon-templates` | `coupon:create` | 创建，**H1**：`creatorMerchantId` 由 JWT 推导（附属商家 403 `COUPON_CREATOR_NOT_MAIN`）；创建后固定 `DRAFT` |
| PUT | `/coupon-templates/:id` | `coupon:edit` | 编辑，仅 DRAFT / UNPUBLISHED（`TEMPLATE_NOT_EDITABLE`）；库存不得小于 `issuedCount` |
| PATCH | `/coupon-templates/:id/publish` | `coupon:publish` | 上架（校验库存>0、FIXED 未过期、指定门店非空） |
| PATCH | `/coupon-templates/:id/unpublish` | `coupon:publish` | 下架（仅 PUBLISHED 可下架） |

写操作均写 `audit_logs`（`module=coupon`，action=`coupon:create|update|publish|unpublish`）。

#### 已知限制：适用范围「指定商家」（`applyScope=SPECIFIED_MERCHANTS`）

**MVP 不实现，标记为「已知限制，计划在未来的 v2 版本支持」**，不再作为 S2 收口待办项。

- 行为：创建 / 编辑模板传 `applyScope=SPECIFIED_MERCHANTS` → **400 `APPLY_SCOPE_UNSUPPORTED`**（错误信息：「适用范围 SPECIFIED_MERCHANTS 尚未实现（S4 规划），请选择全部门店或指定门店」），**不做「传了但静默不生效」**这种危险降级；
- 核销侧同样保持不通过：走这条分支返回 **409 `APPLY_SCOPE_UNSUPPORTED`**（`F-06`），不会放行一张适用范围未知的券；
- MVP 支持范围：`ALL_STORES`（全部门店）、`SPECIFIED_STORES`（指定门店）；
- 需求侧该项已移入 **v2 计划**（见 docs/01「MVP 范围外（v2 计划）」）。

> 之所以不临时用「打标 + 应用层过滤」糊一个版本：指定商家的语义是「属于该商家的**所有门店，含后续新开门店**」，
> 一旦只按当前门店打标就会随着门店扩张静默失效（发券时合法、核销时不合法）。正式实现需要 `coupon_template_merchants`
> 关联表 + 核销时按商家做一次归属查询，属于 v2 的范围。

### 6.2 券码预生成与查询（S2.2 已实现）

| 方法 | 路径 | 权限码 | 说明 |
|---|---|---|---|
| POST | `/coupon-templates/:id/codes` | `coupon:code:generate` | 预生成券码。券码 12 位 = 11 位 crypto 随机位 + 1 位校验位，字符集 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`（31 个，去掉 0/O/1/I/L）；`batchNo` 不传自动生成 `{templateId}-{yyyymmdd}-{seq}`。**同批次重复 → 409 `BATCH_ALREADY_EXISTS`**（`coupon_code_batches.batchNo` 唯一索引兜底，非应用层 count 预检） |
| GET | `/coupon-templates/:id/codes` | `coupon:view` | 券码列表（status / batchNo / code 筛选 + 分页），返回 `stats{unused,issued,redeemed}`；越权 404 |
| GET | `/coupon-templates/:id/batches` | `coupon:view` | 批次列表（含每批实际生成数量） |

> **算法说明**：随机位用 `crypto.randomBytes` 取 16 位整数并**拒绝采样**（丢弃 `[65534,65535]`）消除取模偏差；
> 校验位 `check = CHARSET[(Σ (idx(c)+1)×(i+1)) mod 31]`，位置加权可拦「错一位」与大部分「相邻写反」。
> docs/02 写的「32 字符」按规则 36−5 实为 **31**，31^11 ≈ 2.5×10^16，不影响唯一性，不为凑数放回 L。

### 6.3 券实例（S2.2 已实现）

| 方法 | 路径 | 权限码 | 说明 |
|---|---|---|---|
| POST | `/coupon-instances/issue` | `coupon:issue-main` 或 `coupon:issue`（OR） | **发券核心**。流程：① 授权/状态校验（附属一律走 `checkAuthorization`，即便发自己的附属券也不行）→ ② 库存**条件更新** `WHERE totalStock-issuedCount >= N`（并发安全，409 `STOCK_EXHAUSTED`）→ ③ 券码 `SELECT ... FOR UPDATE` 锁行取用（409 `CODE_POOL_EXHAUSTED`）→ ④ 建实例+绑码 → ⑤ 同事务审计 `coupon:issue`。`userId` / `phone` 二选一，单次 ≤50 张 |
| GET | `/coupon-instances` | `coupon:instance:view` | 列表（templateId / userId / status / code / expireFrom~to / issuerMerchantId）。**数据隔离**：主体=自己拥有或创建的模板下的券；附属=自己发放或自己名下的；附属传别人的 `issuerMerchantId` → 403 `FORBIDDEN_SCOPE` |
| GET | `/coupon-instances/:id` | `coupon:instance:view` | 详情（含面值、适用门店）；越权 404 |
| PATCH | `/coupon-instances/:id/freeze` | `coupon:instance:freeze` | 冻结 / 解冻（`frozen` 布尔 + `reason`）。仅 UNUSED 可冻、FROZEN 可解冻，否则 409 `COUPON_NOT_FREEZABLE` |

新增 ReasonCode：`BATCH_ALREADY_EXISTS` / `STOCK_EXHAUSTED` / `CODE_POOL_EXHAUSTED` / `COUPON_NOT_FREEZABLE`。

### 6.4 核销与冲正（S2.3 已实现）

| 方法 | 路径 | 权限码 | 说明 |
|---|---|---|---|
| POST | `/redemptions/verify` | `redemption:verify` / `redemption:create`（OR） | **只读**校验，**HTTP 200**（S2.4 追问1：只读操作不返回 201 Created）。可核销 → 200 + `redeemable:true` + 券信息 + 逐项 `checks`；不可核销 → **404/403/409**（`CODE_NOT_FOUND` / `COUPON_ALREADY_USED` / `COUPON_FROZEN` / `COUPON_EXPIRED` / `TEMPLATE_NOT_AVAILABLE` / `STORE_NOT_OWNED` / `STORE_NOT_IN_SCOPE` / `COUPON_NOT_BELONG_TO_USER` / `THRESHOLD_NOT_MET` / `ORDER_ALREADY_HAS_COUPON`），且响应 `data` 仍带 `coupon/checks` 供前端展示 |
| POST | `/redemptions` | `redemption:create` | 执行核销。`orderNo` 必填（不存在则创建 CONSUME 订单）。事务内：订单条件绑定（409 `ORDER_ALREADY_HAS_COUPON`）→ 券实例条件更新 UNUSED→USED（409）→ 券码 REDEEMED → 模板 `usedCount+1` → 核销记录（`@@unique([couponInstanceId,status])` 兜底）→ 审计 `redemption:create`。**幂等键**：可选 `requestId`，同 `(userId, requestId)` 重复提交返回首次结果（200 + `idempotent:true`），不报 409；唯一索引 `redemption_records(userId, requestId)` 兜底，同键并发由应用层回读重放 |
| GET | `/redemptions` | `redemption:view` | 列表（code / templateId / userId / storeId / merchantId / status / 时间筛选）+ `summary` 按商家分组合计。**数据隔离**：平台全量；主体=自己门店 + 自己模板的核销；附属 / 店员=本店；附属传别人 `merchantId` → 403 `FORBIDDEN_SCOPE` |
| POST | `/redemptions/:id/reverse` | `redemption:reverse` | 冲正：记录置 `REVERSED`（保留追溯），券回 `UNUSED`、券码回 `ISSUED`、`usedCount−1`、订单解绑。**`reason` 必填（≥5 字符）**，写入 `redemption_records.reverseReason` + 审计日志。**权限收紧（S2.4）**：附属商家 / 店员只能冲正**本店 + 核销后 24 小时内**的记录 → 超时 403 `REVERSE_WINDOW_EXPIRED`、跨店 403 `STORE_NOT_OWNED`，需主体商家操作（主体 / 平台无时间窗）。重复冲正 → 409 `REDEMPTION_ALREADY_REVERSED`。场景：订单取消 / 误核销 / 异常订单判定券不参与结算 |

数据库约束 DDL（幂等）：`server/prisma/sql/s23-redemption-constraints.sql` —— `orders.couponInstanceId` UNIQUE（一单一券）+ `redemption_records(couponInstanceId, status)` UNIQUE（核销幂等，H3/H4）。

## 7. 核销

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/redemptions/verify` | 校验券码，返回 `{canRedeem, reasonCode, reasonText}`（H5） |
| POST | `/redemptions` | 执行核销（H4 事务 + 幂等键） **[SCOPED]** |
| GET | `/redemptions` | 核销记录 **[SCOPED]** |
| POST | `/redemptions/:id/reverse` | 冲正 **[MAIN]** |

## 8. 积分

### 8.1 积分账户与流水（S3.1 已实现）

| 方法 | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | `/point-accounts` | `point:view` | 账户列表（关键词 / 最低余额 / 仅看临期筛选）。每行带 `expiringSoon`（30 天内过期的可用积分）。可见范围：平台全量；主体商家=自己+直属附属体系内有积分流水的用户；附属/店员=本店/本门店 |
| GET | `/point-accounts/:userId` | `point:view` | 账户详情：余额 + **批次明细**（未过期且未用完，按 expireAt 升序 = FIFO 消耗顺序，`usable` 标记过期批次）+ 汇总（`available` 才是真正能花的 / `expiredPending` 待 S3.3 清理）。越权 → 403 `FORBIDDEN_SCOPE` |
| GET | `/point-transactions` | `point:view` | 积分流水（类型 / 用户 / 商家 / 门店 / 时间筛选）。每条带 `remainingAmount`（批次剩余）与 `balanceAfter`。附属指定别的 merchantId → 403 `FORBIDDEN_SCOPE`；主体商家能看到无商家归属的人工调整，附属不能 |

### 8.2 积分写操作（S3.1 已实现）

| 方法 | 路径 | 权限码 | 说明 |
|---|---|---|---|
| POST | `/points/earn` | `point:earn` | **消费录单送积分（内部接口，S3.4 订单模块复用）**。归属由 JWT 推导（店员=本店，商家传别家 → 403 `FORBIDDEN_SCOPE` / `STORE_NOT_OWNED`；主体可用直属附属门店，积分记门店所属商家名下）。规则商家级优先、其次平台级（`merchantId=0`）。折算 `points = floor(amount × earnRatio)`，低于 `minAmount` → 201 + `earned:false`（业务规则不是错误）。传 `orderId`/`orderNo` 启用**一单只送一次**幂等（唯一索引 `(relatedOrderId, type)` 兜底）→ 重复 409 `ORDER_POINTS_ALREADY_EARNED`。事务：EARN 批次 + 账户**乐观锁**（`WHERE version=?`，冲突整事务重试 3 次，含 MySQL 瞬时死锁 1213/1205）→ 超过 409 `CONCURRENT_UPDATE`。有效期：FIXED_MONTHS 按自然月 / YEAR_END 到当年 12-31 |
| POST | `/points/adjust` | `point:adjust` | 人工调整（正增负减）。`reason` 必填 ≥5 字符，写 ADJUST 流水 + `audit_logs`（before/after 含账户 version）。负向**走 FIFO 扣减**（与兑换一致，过期批次不可用），不足 409 `BALANCE_NOT_ENOUGH`。乐观锁同上 |
| GET | `/point-rules` | `point:rule:view` / `point:view` | 规则列表（平台看全部；商家看自己 + 平台默认，`level` 区分 PLATFORM/MERCHANT） |
| PUT | `/point-rules/:id` | `point:rule:edit` | 修改规则（`earnRatio` / `minAmount` / `pointsValidMonths` / `expireMode` / `status`），写审计 before/after；同一商家只能有一条生效规则 → 409 `POINT_RULE_ALREADY_ACTIVE`；商家改平台规则 → 403 `FORBIDDEN_SCOPE` |

数据库约束（`server/prisma/sql/s31-point-constraints.sql`，幂等脚本已执行）：

| 约束 | 表 / 列 | 拦截 |
|---|---|---|
| `uniq_point_earn_order`（UNIQUE `(relatedOrderId, type)`） | `point_transactions` | 同一订单只送一次积分（防双倍积分）；`relatedOrderId` 为 NULL 的流水不受影响（MySQL NULL 互不相等） |
| `idx_point_fifo`（`(userId, expireAt, remainingAmount)`） | `point_transactions` | FIFO 扣减 / 过期扫描的覆盖索引（S3.2 / S3.3 复用） |

S3.2 将实现：`POST /points/exchange`（FIFO 扣减 + 生成券实例）、`GET /h5/points/exchange-records`。
S3.3 将实现：`POST /tasks/points/expire`（过期清零定时任务 + 手动触发）。
S3.4 将实现：`GET /orders/*`、`POST /orders`（补录订单调用 `/points/earn`）、异常订单处理。


## 9. 订单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/orders` | 列表 **[SCOPED]** |
| GET | `/orders/:id` | 详情（券/积分/核销） **[SCOPED]** |
| POST | `/orders` | 后台补录（H3 一单一券校验） |
| PATCH | `/orders/:id/abnormal` | 标记异常 |
| POST | `/orders/:id/handle` | 异常处理（退款/回退券/冲正核销/备注） |
| GET | `/orders/abnormal` | 异常订单列表 |

## 10. 采购与对账（仅对账数据，无资金流）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST | `/purchases` | 列表 / 新增 **[MAIN]** |
| GET | `/purchases` | 本店采购记录 **[SUB][SCOPED]** |
| PATCH | `/purchases/:id/settle` | 标记线下已结算 |
| POST | `/settlements/generate` | 生成对账账单（周期 + 商家） **[MAIN]** |
| GET | `/settlements` | 账单列表 **[SCOPED]** |
| GET | `/settlements/:id` | 详情（采购明细 + 核销明细） |
| PATCH | `/settlements/:id/confirm` | 确认 / 提出异议 |
| GET | `/settlements/:id/export` | 导出（前端 CSV） |

## 11. 报表中心 **[MAIN]**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/reports/merchant-onboarding` | 商户入驻报表 |
| GET | `/reports/orders-summary` | 全平台订单汇总 |
| GET | `/reports/coupon-summary` | 券 创建/兑换/核销/过期 汇总 |
| GET | `/reports/points-summary` | 积分 发放/消耗/过期 流水汇总 |
| GET | `/reports/store-settlement` | 各附属商家 采购/核销 对账汇总 |
| GET | `/reports/authorization-logs` | 附属商家授权记录 |
| GET | `/reports/:key/export` | 通用导出（**MVP 前端 CSV**） |

## 12. 用户管理（只读，建议 8）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/users` | 用户列表（手机号/昵称/积分余额/注册时间） **[MAIN]** |
| GET | `/users/:id` | 用户详情 |
| GET | `/users/:id/orders` | 该用户订单 |
| GET | `/users/:id/redemptions` | 该用户核销记录 |
| GET | `/users/:id/point-transactions` | 该用户积分流水 |

## 13. 通知（站内信）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/notifications` | 列表 + 未读数 **[SCOPED]** |
| POST | `/notifications` | 发布（主体 → 指定商家/门店/全部） **[MAIN]** |
| PATCH | `/notifications/:id/read` | 标记已读 |
| PATCH | `/notifications/read-all` | 全部已读 |
| GET | `/notifications/targets` | 可选发布目标（本主体可发布的附属商家 + 其营业中门店）`{ merchants, stores }` **[MAIN]** |

> **`GET /notifications/targets` 无分页**：商家与门店各取**上限 2000**（`take: 2000`）。命中上限时服务端打 warn「targets 超过 2000，需要分页」并返回截断结果；若单主体规模可能超过 2000，需先改为游标/分页方案。
> 该接口与 `POST /notifications` **共用 `senderMerchantScope`**，保证「前端选得到的 = 后端允发的」（见验收用例 T8–T11）。

## 14. 日志与上传

操作日志为只读模块：写入只能由各业务模块经 `AuditService.record()` 完成（写库失败随主事务回滚，不会丢单独的日志），这里只提供查询。权限码 `audit:view`（默认仅平台管理员与主体商家角色持有）；即便持有权限码，可见范围仍按 JWT 归属收敛（平台=全部；商家=本主体+直属附属的「操作人」或「目标」）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/audit-logs` | 操作日志列表（分页）。筛选：`module` / `operatorId` / `operatorKeyword` / `action` / `targetType` / `targetId` / `result` / `from`~`to`。列表不含 before/after **[audit:view]** |
| GET | `/audit-logs/:id` | 日志详情：`before` / `after` 变更对比，口令、token 等敏感字段已替换为 `******`；越权或不存在一律 404 **[audit:view]** |
| POST | `/upload/image` | 图片上传（本地，后续 OSS） |
| GET | `/health` | 健康检查（S0 提供） |

## 15. 用户端 H5（S6 最简版 3 页）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/h5/points/balance` | 积分余额与临期提醒 |
| GET | `/h5/coupon-templates` | 可兑换券列表 |
| POST | `/h5/points/exchange` | 积分兑换 |
| GET | `/h5/my/coupons` | 我的卡包（未用/已用/过期） |
| GET | `/h5/my/coupons/:id` | 券详情（券码） |
| GET | `/h5/points/transactions` | 积分变动记录 |

---

## 附：权限码清单（S1 简化版）

```
dashboard:view
merchant:view  merchant:audit  merchant:manage
store:view  store:manage  store:change-request
authorization:view  authorization:manage
coupon:create  coupon:publish  coupon:issue-main  coupon:view
redemption:create  redemption:view  redemption:reverse
point:rule:edit  point:adjust  point:view
order:view  order:handle
purchase:manage  settlement:confirm  settlement:view
report:view  report:export
user:view
notification:manage  notification:view
audit:view
```
