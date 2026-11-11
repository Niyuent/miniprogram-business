-- =============================================================================
-- S3.1 积分账户 / 积分流水：幂等与并发相关的约束
--
-- 执行方式（幂等，可重复跑）：
--   docker compose cp server/prisma/sql/s31-point-constraints.sql mysql:/tmp/s31.sql
--   docker compose exec -T mysql bash -c "mysql -uroot -p'$MYSQL_ROOT_PASSWORD' shangmeng < /tmp/s31.sql"
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 同一订单只能送一次积分（防「双倍积分」漏洞）
--
-- 口径：一次消费录单 = 一条 EARN 流水，同一个订单重复提交必须只有一条生效。
-- 应用层先查再插只是「减少冲突概率」，真正兜底要靠唯一索引：
-- 两个并发请求都查不到、都插入时，数据库会让其中一个报 1062（Prisma P2002），
-- 服务层把它翻译成 409 ORDER_POINTS_ALREADY_EARNED，并整事务回滚——余额不会翻倍。
--
-- 注意：MySQL 唯一索引中 NULL 互不相等，所以 related_order_id 为 NULL 的流水
-- （无订单来源的人工调整等）不受这条约束影响，正好是我们要的语义。
-- -----------------------------------------------------------------------------
SET @idx_earn := (
  SELECT COUNT(1) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'point_transactions'
    AND INDEX_NAME = 'uniq_point_earn_order'
);
SET @sql_earn := IF(
  @idx_earn = 0,
  'ALTER TABLE point_transactions ADD UNIQUE KEY uniq_point_earn_order (relatedOrderId, type)',
  'SELECT ''uniq_point_earn_order already exists'''
);
PREPARE stmt FROM @sql_earn;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 2. FIFO 扣减要扫描的索引：expireAt + remainingAmount（S3.2 兑换 / S3.3 过期都走它）
-- -----------------------------------------------------------------------------
SET @idx_fifo := (
  SELECT COUNT(1) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'point_transactions'
    AND INDEX_NAME = 'idx_point_fifo'
);
SET @sql_fifo := IF(
  @idx_fifo = 0,
  'ALTER TABLE point_transactions ADD KEY idx_point_fifo (userId, expireAt, remainingAmount)',
  'SELECT ''idx_point_fifo already exists'''
);
PREPARE stmt FROM @sql_fifo;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =============================================================================
-- 验证：应当看到 uniq_point_earn_order（NON_UNIQUE=0）与 idx_point_fifo（NON_UNIQUE=1）
-- =============================================================================
SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'point_transactions'
  AND INDEX_NAME IN ('uniq_point_earn_order', 'idx_point_fifo')
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
