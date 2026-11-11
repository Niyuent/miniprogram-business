-- 回滚 S5.4-B1（与 migration.sql 对称，可重复执行）
--
-- ⚠️ 注意：
--   1. 回滚会**丢弃「每人各自已读」的独立状态**（notification_reads 整表删除）；
--   2. `notifications.readStatus` / `readAt` 迁移时未删除，故回滚后旧口径（单一已读状态）依然可读，
--      代码回退 + 执行本脚本即可平滑回到 S5.4-A 行为；
--   3. 回滚会同时删除 senderId / sendBatchId（「我发过的通知」功能随之失效，属预期）。

DROP TABLE IF EXISTS `notification_reads`;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
                   AND INDEX_NAME = 'notifications_senderId_createdAt_idx');
SET @ddl := IF(@has_idx > 0, 'DROP INDEX `notifications_senderId_createdAt_idx` ON `notifications`', 'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'sendBatchId');
SET @ddl := IF(@has_col > 0, 'ALTER TABLE `notifications` DROP COLUMN `sendBatchId`', 'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'senderId');
SET @ddl := IF(@has_col > 0, 'ALTER TABLE `notifications` DROP COLUMN `senderId`', 'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '[s54b] 回滚完成：已删除 notification_reads、senderId、sendBatchId（readStatus/readAt 保留）' AS migration_log;
