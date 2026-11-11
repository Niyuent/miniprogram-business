-- 多联盟（多租户）第一阶段：表结构
-- 1) alliances / merchant_alliances
-- 2) point_accounts / point_transactions / coupon_templates / point_rules 增加 allianceId
-- 3) 历史数据挂靠默认联盟「星链商盟」id=1

-- ---------------------------------------------------------------- alliances
CREATE TABLE `alliances` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `mainMerchantId` INTEGER UNSIGNED NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `alliances_mainMerchantId_idx`(`mainMerchantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 默认星链商盟：盟主取现有 MAIN 商家（优先已审核），否则任意商家
INSERT INTO `alliances` (`id`, `name`, `mainMerchantId`, `createdAt`, `updatedAt`)
SELECT
  1,
  '星链商盟',
  COALESCE(
    (SELECT `id` FROM `merchants` WHERE `type` = 'MAIN' AND `status` = 'APPROVED' ORDER BY `id` ASC LIMIT 1),
    (SELECT `id` FROM `merchants` WHERE `type` = 'MAIN' ORDER BY `id` ASC LIMIT 1),
    (SELECT `id` FROM `merchants` ORDER BY `id` ASC LIMIT 1)
  ),
  NOW(3),
  NOW(3)
FROM DUAL
WHERE EXISTS (SELECT 1 FROM `merchants` LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM `alliances` WHERE `id` = 1);

ALTER TABLE `alliances`
  ADD CONSTRAINT `alliances_mainMerchantId_fkey`
  FOREIGN KEY (`mainMerchantId`) REFERENCES `merchants`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- merchant_alliances
CREATE TABLE `merchant_alliances` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `merchantId` INTEGER UNSIGNED NOT NULL,
    `allianceId` INTEGER UNSIGNED NOT NULL,
    `role` ENUM('MAIN', 'SUB') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_alliances_merchantId_allianceId_key`(`merchantId`, `allianceId`),
    INDEX `merchant_alliances_allianceId_role_idx`(`allianceId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `merchant_alliances` (`merchantId`, `allianceId`, `role`, `createdAt`, `updatedAt`)
SELECT
  m.`id`,
  1,
  CASE WHEN m.`type` = 'MAIN' THEN 'MAIN' ELSE 'SUB' END,
  NOW(3),
  NOW(3)
FROM `merchants` m
WHERE EXISTS (SELECT 1 FROM `alliances` WHERE `id` = 1)
  AND NOT EXISTS (
    SELECT 1 FROM `merchant_alliances` ma
    WHERE ma.`merchantId` = m.`id` AND ma.`allianceId` = 1
  );

ALTER TABLE `merchant_alliances`
  ADD CONSTRAINT `merchant_alliances_merchantId_fkey`
  FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `merchant_alliances`
  ADD CONSTRAINT `merchant_alliances_allianceId_fkey`
  FOREIGN KEY (`allianceId`) REFERENCES `alliances`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- point_accounts：userId 唯一 → (userId, allianceId) 唯一
-- MySQL：userId 唯一索引被 userId FK 依赖，须先删 FK 再删唯一索引
ALTER TABLE `point_accounts` DROP FOREIGN KEY `point_accounts_userId_fkey`;

ALTER TABLE `point_accounts`
  ADD COLUMN `allianceId` INTEGER UNSIGNED NULL;

UPDATE `point_accounts` SET `allianceId` = 1 WHERE `allianceId` IS NULL;

ALTER TABLE `point_accounts`
  MODIFY COLUMN `allianceId` INTEGER UNSIGNED NOT NULL;

DROP INDEX `point_accounts_userId_key` ON `point_accounts`;

CREATE UNIQUE INDEX `point_accounts_userId_allianceId_key` ON `point_accounts`(`userId`, `allianceId`);
CREATE INDEX `point_accounts_allianceId_idx` ON `point_accounts`(`allianceId`);

ALTER TABLE `point_accounts`
  ADD CONSTRAINT `point_accounts_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `point_accounts`
  ADD CONSTRAINT `point_accounts_allianceId_fkey`
  FOREIGN KEY (`allianceId`) REFERENCES `alliances`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- point_transactions
ALTER TABLE `point_transactions`
  ADD COLUMN `allianceId` INTEGER UNSIGNED NULL;

UPDATE `point_transactions` SET `allianceId` = 1 WHERE `allianceId` IS NULL;

ALTER TABLE `point_transactions`
  MODIFY COLUMN `allianceId` INTEGER UNSIGNED NOT NULL;

DROP INDEX `point_transactions_userId_type_createdAt_idx` ON `point_transactions`;

CREATE INDEX `point_transactions_userId_allianceId_type_createdAt_idx`
  ON `point_transactions`(`userId`, `allianceId`, `type`, `createdAt`);
CREATE INDEX `point_transactions_allianceId_createdAt_idx`
  ON `point_transactions`(`allianceId`, `createdAt`);

ALTER TABLE `point_transactions`
  ADD CONSTRAINT `point_transactions_allianceId_fkey`
  FOREIGN KEY (`allianceId`) REFERENCES `alliances`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- coupon_templates
ALTER TABLE `coupon_templates`
  ADD COLUMN `allianceId` INTEGER UNSIGNED NULL;

UPDATE `coupon_templates` SET `allianceId` = 1 WHERE `allianceId` IS NULL;

ALTER TABLE `coupon_templates`
  MODIFY COLUMN `allianceId` INTEGER UNSIGNED NOT NULL;

CREATE INDEX `coupon_templates_allianceId_status_idx` ON `coupon_templates`(`allianceId`, `status`);

ALTER TABLE `coupon_templates`
  ADD CONSTRAINT `coupon_templates_allianceId_fkey`
  FOREIGN KEY (`allianceId`) REFERENCES `alliances`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- point_rules
ALTER TABLE `point_rules`
  ADD COLUMN `allianceId` INTEGER UNSIGNED NULL;

UPDATE `point_rules` SET `allianceId` = 1 WHERE `allianceId` IS NULL;

ALTER TABLE `point_rules`
  MODIFY COLUMN `allianceId` INTEGER UNSIGNED NOT NULL;

DROP INDEX `point_rules_merchantId_status_key` ON `point_rules`;

CREATE UNIQUE INDEX `point_rules_allianceId_merchantId_status_key`
  ON `point_rules`(`allianceId`, `merchantId`, `status`);
CREATE INDEX `point_rules_allianceId_status_idx` ON `point_rules`(`allianceId`, `status`);

ALTER TABLE `point_rules`
  ADD CONSTRAINT `point_rules_allianceId_fkey`
  FOREIGN KEY (`allianceId`) REFERENCES `alliances`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
