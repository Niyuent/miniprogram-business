-- ============================================================================
-- S2.3 核销：支撑硬约束的数据库唯一约束
--
-- 这两条约束是「一单一券」和「核销幂等」的**最后一道防线**。
-- 应用层已经用条件更新保证并发下只成功一次，但那依赖代码永远写对；
-- 唯一索引是数据库级的兜底 —— 任何绕过服务的脚本 / 手工改库 / 未来新增的写入路径，
-- 都造不出「一张券两条 SUCCESS 核销记录」或「一个订单两张券」。
--
-- 说明：
--   * 这两个约束在 0_init 迁移里已随 schema 建立，本脚本**幂等**，
--     用于在任意环境（含手工改过的库）复核 / 补齐，可反复执行。
--   * MySQL 8 没有 `ADD UNIQUE KEY IF NOT EXISTS`，故用 information_schema 判断后
--     动态拼接 DDL（PREPARE / EXECUTE），不依赖 DELIMITER。
--
-- 执行：
--   docker compose exec -T mysql mysql -ushangmeng -pshangmeng shangmeng < server/prisma/sql/s23-redemption-constraints.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- H3 一单一券：orders.couponInstanceId 唯一
-- 违反 → 409 ORDER_ALREADY_HAS_COUPON
-- ---------------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'orders_couponInstanceId_key'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE orders ADD UNIQUE KEY orders_couponInstanceId_key (couponInstanceId)',
  'SELECT "orders.couponInstanceId 唯一索引已存在，跳过" AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- H4 核销幂等：redemption_records (couponInstanceId, status) 唯一
--   → 同一张券不可能存在两条 SUCCESS（冲正后记录变 REVERSED，SUCCESS 槽位被释放，
--     所以「冲正 → 再次核销」是允许的，这正是冲正与删除记录的区别）
-- 违反 → 409 COUPON_ALREADY_USED
-- ---------------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'redemption_records'
    AND INDEX_NAME = 'redemption_records_couponInstanceId_status_key'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE redemption_records ADD UNIQUE KEY redemption_records_couponInstanceId_status_key (couponInstanceId, status)',
  'SELECT "redemption_records (couponInstanceId, status) 唯一索引已存在，跳过" AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 核销记录查询索引：列表按 merchantId / storeId / redeemedAt 排序分页
-- ---------------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'redemption_records'
    AND INDEX_NAME = 'redemption_records_merchantId_storeId_redeemedAt_idx'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE redemption_records ADD INDEX redemption_records_merchantId_storeId_redeemedAt_idx (merchantId, storeId, redeemedAt)',
  'SELECT "redemption_records 查询索引已存在，跳过" AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 核销幂等键：redemption_records (userId, requestId) 唯一
--   → 同键重试返回首次结果（200 + idempotent:true），不会重复核销
--   → requestId 可空：历史行与不传键的调用方（Web 后台）不受影响，NULL 不占唯一槽位
-- 违反（同键并发）→ 应用层回读重放，不报冲突
-- ---------------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'redemption_records'
    AND INDEX_NAME = 'redemption_records_userId_requestId_key'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE redemption_records ADD UNIQUE KEY redemption_records_userId_requestId_key (userId, requestId)',
  'SELECT "redemption_records (userId, requestId) 唯一索引已存在，跳过" AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 验证：四条唯一 / 索引约束都应存在
-- ============================================================================
SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND INDEX_NAME IN (
    'orders_couponInstanceId_key',
    'redemption_records_couponInstanceId_status_key',
    'redemption_records_merchantId_storeId_redeemedAt_idx',
    'redemption_records_userId_requestId_key'
  )
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
