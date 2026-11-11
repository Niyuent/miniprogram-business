-- S5.4-B1 站内信：
--   ① 通知改为「每人各自已读」—— 新建 notification_reads（notificationId + adminUserId 唯一）；
--   ② notifications 增加 senderId（发布人）与 sendBatchId（一次发送动作的批次号，用于「我发过的通知」聚合）；
--   ③ 历史 readStatus=READ 的记录回填到 notification_reads（归到该接收方名下最早的管理员；找不到则跳过）。
--
-- 幂等：本脚本可重复执行（建表 IF NOT EXISTS、加列/加索引先查 information_schema、回填用 NOT EXISTS + INSERT IGNORE）。
-- 回滚：见同目录 rollback.sql（保留 notifications.readStatus/readAt，不删列）。
-- 说明：prisma migrate deploy 不打印 SELECT 结果，故回填统计以 audit_logs 的一行记录留痕（action=notification:read-backfill）。

-- ---------------------------------------------------------------- 1) notifications 新增列

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'senderId');
SET @ddl := IF(@has_col = 0, 'ALTER TABLE `notifications` ADD COLUMN `senderId` INTEGER UNSIGNED NULL', 'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'sendBatchId');
SET @ddl := IF(@has_col = 0, 'ALTER TABLE `notifications` ADD COLUMN `sendBatchId` VARCHAR(36) NULL', 'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
                   AND INDEX_NAME = 'notifications_senderId_createdAt_idx');
SET @ddl := IF(@has_idx = 0, 'CREATE INDEX `notifications_senderId_createdAt_idx` ON `notifications` (`senderId`, `createdAt`)', 'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------- 2) notification_reads

CREATE TABLE IF NOT EXISTS `notification_reads` (
  `id`             INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
  `notificationId` INTEGER UNSIGNED NOT NULL,
  `adminUserId`    INTEGER UNSIGNED NOT NULL,
  `readAt`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `notification_reads_notificationId_adminUserId_key` (`notificationId`, `adminUserId`),
  INDEX `notification_reads_adminUserId_idx` (`adminUserId`),
  CONSTRAINT `notification_reads_notificationId_fkey`
    FOREIGN KEY (`notificationId`) REFERENCES `notifications` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 3) 回填（幂等）

SET @read_total := (SELECT COUNT(*) FROM `notifications` WHERE `readStatus` = 'READ');

INSERT IGNORE INTO `notification_reads` (`notificationId`, `adminUserId`, `readAt`)
SELECT n.`id`, a.`id`, IFNULL(n.`readAt`, n.`createdAt`)
FROM `notifications` n
JOIN `admin_users` a
  ON (n.`receiverType` = 'MERCHANT' AND a.`merchantId` = n.`receiverId`)
  OR (n.`receiverType` = 'STORE'    AND a.`storeId`    = n.`receiverId`)
LEFT JOIN `notification_reads` r ON r.`notificationId` = n.`id`
WHERE n.`readStatus` = 'READ'
  AND r.`id` IS NULL
  AND a.`id` = (
    SELECT MIN(a2.`id`) FROM `admin_users` a2
    WHERE (n.`receiverType` = 'MERCHANT' AND a2.`merchantId` = n.`receiverId`)
       OR (n.`receiverType` = 'STORE'    AND a2.`storeId`    = n.`receiverId`)
  );

SET @backfilled := ROW_COUNT();
SET @skipped := (
  SELECT COUNT(*) FROM `notifications` n
  WHERE n.`readStatus` = 'READ'
    AND NOT EXISTS (SELECT 1 FROM `notification_reads` r WHERE r.`notificationId` = n.`id`)
);

-- ---------------------------------------------------------------- 4) 迁移日志（审计留痕）

INSERT INTO `audit_logs` (`operatorId`, `operatorType`, `operatorName`, `module`, `action`, `targetType`, `afterData`, `result`)
VALUES (
  NULL, 'SYSTEM', 'migration:20261015100000_s54b_notification_reads',
  'notification', 'notification:read-backfill', 'notification_read',
  JSON_OBJECT('readTotal', @read_total, 'backfilled', @backfilled, 'skipped', @skipped),
  'SUCCESS'
);

SELECT CONCAT('[s54b] 迁移日志：READ 通知 = ', @read_total,
              '，回填成功 = ', @backfilled,
              '，跳过（接收方无管理员）= ', @skipped) AS migration_log;
