-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(20) NOT NULL,
    `nickname` VARCHAR(50) NULL,
    `avatar` VARCHAR(255) NULL,
    `openid` VARCHAR(64) NULL,
    `unionid` VARCHAR(64) NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_phone_key`(`phone`),
    INDEX `users_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchants` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `parentId` INTEGER UNSIGNED NULL,
    `type` ENUM('MAIN', 'SUB') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `contactName` VARCHAR(50) NULL,
    `contactPhone` VARCHAR(20) NULL,
    `licenseNo` VARCHAR(64) NULL,
    `licenseImages` JSON NULL,
    `province` VARCHAR(32) NULL,
    `city` VARCHAR(32) NULL,
    `district` VARCHAR(32) NULL,
    `address` VARCHAR(255) NULL,
    `settleContact` VARCHAR(255) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `auditRemark` VARCHAR(255) NULL,
    `auditorId` INTEGER UNSIGNED NULL,
    `auditedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchants_code_key`(`code`),
    INDEX `merchants_parentId_status_idx`(`parentId`, `status`),
    INDEX `merchants_type_status_idx`(`type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stores` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `merchantId` INTEGER UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(32) NULL,
    `contactName` VARCHAR(50) NULL,
    `contactPhone` VARCHAR(20) NULL,
    `province` VARCHAR(32) NULL,
    `city` VARCHAR(32) NULL,
    `district` VARCHAR(32) NULL,
    `address` VARCHAR(255) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `lat` DECIMAL(10, 7) NULL,
    `businessHours` VARCHAR(100) NULL,
    `logo` VARCHAR(255) NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `stores_merchantId_status_idx`(`merchantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_users` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `realName` VARCHAR(50) NULL,
    `phone` VARCHAR(20) NULL,
    `merchantId` INTEGER UNSIGNED NULL,
    `storeId` INTEGER UNSIGNED NULL,
    `userType` ENUM('PLATFORM', 'MERCHANT', 'STORE') NOT NULL DEFAULT 'MERCHANT',
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_users_username_key`(`username`),
    INDEX `admin_users_merchantId_idx`(`merchantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `scope` ENUM('PLATFORM', 'MERCHANT', 'STORE') NOT NULL DEFAULT 'MERCHANT',
    `description` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `group` VARCHAR(50) NOT NULL,
    `description` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` INTEGER UNSIGNED NOT NULL,
    `permissionId` INTEGER UNSIGNED NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_user_roles` (
    `adminUserId` INTEGER UNSIGNED NOT NULL,
    `roleId` INTEGER UNSIGNED NOT NULL,

    PRIMARY KEY (`adminUserId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_authorizations` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `mainMerchantId` INTEGER UNSIGNED NOT NULL,
    `subMerchantId` INTEGER UNSIGNED NOT NULL,
    `authType` ENUM('ISSUE_MAIN_COUPON') NOT NULL DEFAULT 'ISSUE_MAIN_COUPON',
    `status` ENUM('ENABLED', 'DISABLED') NOT NULL DEFAULT 'ENABLED',
    `templateScope` ENUM('ALL', 'SPECIFIED') NOT NULL DEFAULT 'ALL',
    `grantedBy` INTEGER UNSIGNED NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedBy` INTEGER UNSIGNED NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `merchant_authorizations_subMerchantId_status_idx`(`subMerchantId`, `status`),
    UNIQUE INDEX `merchant_authorizations_mainMerchantId_subMerchantId_authTyp_key`(`mainMerchantId`, `subMerchantId`, `authType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_authorization_templates` (
    `authorizationId` INTEGER UNSIGNED NOT NULL,
    `templateId` INTEGER UNSIGNED NOT NULL,

    PRIMARY KEY (`authorizationId`, `templateId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_templates` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `creatorMerchantId` INTEGER UNSIGNED NOT NULL,
    `ownerMerchantId` INTEGER UNSIGNED NOT NULL,
    `ownerType` ENUM('MAIN_COUPON', 'SUB_COUPON') NOT NULL DEFAULT 'MAIN_COUPON',
    `name` VARCHAR(100) NOT NULL,
    `subtitle` VARCHAR(100) NULL,
    `couponType` ENUM('VOUCHER', 'DISCOUNT') NOT NULL DEFAULT 'VOUCHER',
    `faceValue` DECIMAL(12, 2) NOT NULL,
    `thresholdAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `pointsCost` INTEGER NOT NULL DEFAULT 0,
    `purchasePrice` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `totalStock` INTEGER NOT NULL DEFAULT 0,
    `issuedCount` INTEGER NOT NULL DEFAULT 0,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `validType` ENUM('FIXED', 'AFTER_RECEIVE_DAYS') NOT NULL DEFAULT 'AFTER_RECEIVE_DAYS',
    `validStart` DATETIME(3) NULL,
    `validEnd` DATETIME(3) NULL,
    `validDays` INTEGER NOT NULL DEFAULT 30,
    `applyScope` ENUM('ALL_STORES', 'SPECIFIED_STORES', 'SPECIFIED_MERCHANTS') NOT NULL DEFAULT 'ALL_STORES',
    `perUserLimit` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `description` VARCHAR(500) NULL,
    `rules` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `coupon_templates_creatorMerchantId_status_idx`(`creatorMerchantId`, `status`),
    INDEX `coupon_templates_ownerMerchantId_ownerType_idx`(`ownerMerchantId`, `ownerType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_template_stores` (
    `templateId` INTEGER UNSIGNED NOT NULL,
    `storeId` INTEGER UNSIGNED NOT NULL,

    PRIMARY KEY (`templateId`, `storeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_codes` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `templateId` INTEGER UNSIGNED NOT NULL,
    `batchNo` VARCHAR(32) NOT NULL,
    `instanceId` INTEGER UNSIGNED NULL,
    `status` ENUM('UNISSUED', 'ISSUED', 'REDEEMED', 'VOID') NOT NULL DEFAULT 'UNISSUED',
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `coupon_codes_code_key`(`code`),
    UNIQUE INDEX `coupon_codes_instanceId_key`(`instanceId`),
    INDEX `coupon_codes_templateId_status_idx`(`templateId`, `status`),
    INDEX `coupon_codes_batchNo_idx`(`batchNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_instances` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `userId` INTEGER UNSIGNED NOT NULL,
    `templateId` INTEGER UNSIGNED NOT NULL,
    `code` VARCHAR(32) NULL,
    `issuerMerchantId` INTEGER UNSIGNED NULL,
    `source` ENUM('EXCHANGE', 'MERCHANT_ISSUE', 'GIFT') NOT NULL DEFAULT 'EXCHANGE',
    `pointsCost` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('UNUSED', 'USED', 'EXPIRED', 'FROZEN') NOT NULL DEFAULT 'UNUSED',
    `obtainedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expireAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `coupon_instances_userId_status_idx`(`userId`, `status`),
    INDEX `coupon_instances_templateId_status_idx`(`templateId`, `status`),
    INDEX `coupon_instances_expireAt_idx`(`expireAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_accounts` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `userId` INTEGER UNSIGNED NOT NULL,
    `balance` INTEGER NOT NULL DEFAULT 0,
    `totalEarned` INTEGER NOT NULL DEFAULT 0,
    `totalSpent` INTEGER NOT NULL DEFAULT 0,
    `totalExpired` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `point_accounts_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_transactions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `userId` INTEGER UNSIGNED NOT NULL,
    `accountId` INTEGER UNSIGNED NOT NULL,
    `type` ENUM('EARN', 'SPEND', 'EXPIRE', 'REFUND', 'ADJUST') NOT NULL,
    `amount` INTEGER NOT NULL,
    `remainingAmount` INTEGER NOT NULL DEFAULT 0,
    `balanceAfter` INTEGER NOT NULL DEFAULT 0,
    `expireAt` DATETIME(3) NULL,
    `relatedOrderId` INTEGER UNSIGNED NULL,
    `relatedCouponInstanceId` INTEGER UNSIGNED NULL,
    `merchantId` INTEGER UNSIGNED NULL,
    `storeId` INTEGER UNSIGNED NULL,
    `operatorId` INTEGER UNSIGNED NULL,
    `remark` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `point_transactions_userId_type_createdAt_idx`(`userId`, `type`, `createdAt`),
    INDEX `point_transactions_expireAt_remainingAmount_idx`(`expireAt`, `remainingAmount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_rules` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `merchantId` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `earnRatio` DECIMAL(8, 2) NOT NULL DEFAULT 1,
    `minAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `pointsValidMonths` INTEGER NOT NULL DEFAULT 12,
    `expireMode` ENUM('FIXED_MONTHS', 'YEAR_END') NOT NULL DEFAULT 'FIXED_MONTHS',
    `effectiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `point_rules_merchantId_status_key`(`merchantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `orderNo` VARCHAR(32) NOT NULL,
    `userId` INTEGER UNSIGNED NOT NULL,
    `merchantId` INTEGER UNSIGNED NOT NULL,
    `storeId` INTEGER UNSIGNED NULL,
    `orderType` ENUM('CONSUME', 'EXCHANGE') NOT NULL DEFAULT 'CONSUME',
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discountAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `payAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `couponInstanceId` INTEGER UNSIGNED NULL,
    `pointsEarned` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('NORMAL', 'ABNORMAL', 'REFUNDED', 'CANCELED') NOT NULL DEFAULT 'NORMAL',
    `abnormalType` VARCHAR(50) NULL,
    `abnormalRemark` VARCHAR(500) NULL,
    `handledBy` INTEGER UNSIGNED NULL,
    `handledAt` DATETIME(3) NULL,
    `handleResult` VARCHAR(500) NULL,
    `source` ENUM('APPLET', 'WEB', 'IMPORT') NOT NULL DEFAULT 'WEB',
    `consumeTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_orderNo_key`(`orderNo`),
    UNIQUE INDEX `orders_couponInstanceId_key`(`couponInstanceId`),
    INDEX `orders_merchantId_storeId_createdAt_idx`(`merchantId`, `storeId`, `createdAt`),
    INDEX `orders_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `redemption_records` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `couponInstanceId` INTEGER UNSIGNED NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `userId` INTEGER UNSIGNED NOT NULL,
    `storeId` INTEGER UNSIGNED NULL,
    `merchantId` INTEGER UNSIGNED NULL,
    `operatorId` INTEGER UNSIGNED NULL,
    `templateId` INTEGER UNSIGNED NOT NULL,
    `faceValue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discountAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `orderId` INTEGER UNSIGNED NULL,
    `channel` ENUM('MANUAL', 'SCAN', 'API') NOT NULL DEFAULT 'MANUAL',
    `status` ENUM('SUCCESS', 'REVERSED') NOT NULL DEFAULT 'SUCCESS',
    `redeemedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `redemption_records_merchantId_storeId_redeemedAt_idx`(`merchantId`, `storeId`, `redeemedAt`),
    UNIQUE INDEX `redemption_records_couponInstanceId_status_key`(`couponInstanceId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_records` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `purchaseNo` VARCHAR(32) NOT NULL,
    `subMerchantId` INTEGER UNSIGNED NOT NULL,
    `mainMerchantId` INTEGER UNSIGNED NOT NULL,
    `templateId` INTEGER UNSIGNED NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `totalAmount` DECIMAL(12, 2) NOT NULL,
    `settleStatus` ENUM('UNSETTLED', 'SETTLED') NOT NULL DEFAULT 'UNSETTLED',
    `settleRemark` VARCHAR(255) NULL,
    `purchasedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `operatorId` INTEGER UNSIGNED NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_records_purchaseNo_key`(`purchaseNo`),
    INDEX `purchase_records_subMerchantId_settleStatus_idx`(`subMerchantId`, `settleStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settlement_reports` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `reportNo` VARCHAR(32) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `merchantId` INTEGER UNSIGNED NULL,
    `reportType` ENUM('PURCHASE', 'REDEMPTION', 'SUMMARY') NOT NULL DEFAULT 'SUMMARY',
    `totalCount` INTEGER NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` ENUM('GENERATING', 'GENERATED', 'CONFIRMED', 'DISPUTED') NOT NULL DEFAULT 'GENERATED',
    `detail` JSON NULL,
    `generatedBy` INTEGER UNSIGNED NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedAt` DATETIME(3) NULL,

    UNIQUE INDEX `settlement_reports_reportNo_key`(`reportNo`),
    INDEX `settlement_reports_merchantId_periodStart_periodEnd_idx`(`merchantId`, `periodStart`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `receiverType` ENUM('MERCHANT', 'STORE', 'USER') NOT NULL,
    `receiverId` INTEGER UNSIGNED NOT NULL,
    `type` ENUM('SYSTEM', 'AUDIT_RESULT', 'AUTH_CHANGE', 'ABNORMAL_ORDER', 'SETTLEMENT') NOT NULL DEFAULT 'SYSTEM',
    `title` VARCHAR(100) NOT NULL,
    `content` VARCHAR(1000) NOT NULL,
    `level` ENUM('NORMAL', 'IMPORTANT', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `bizType` VARCHAR(50) NULL,
    `bizId` INTEGER UNSIGNED NULL,
    `readStatus` ENUM('UNREAD', 'READ') NOT NULL DEFAULT 'UNREAD',
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_receiverType_receiverId_readStatus_idx`(`receiverType`, `receiverId`, `readStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `operatorId` INTEGER UNSIGNED NULL,
    `operatorType` VARCHAR(32) NULL,
    `operatorName` VARCHAR(50) NULL,
    `module` VARCHAR(50) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `targetType` VARCHAR(50) NULL,
    `targetId` INTEGER UNSIGNED NULL,
    `beforeData` JSON NULL,
    `afterData` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `result` ENUM('SUCCESS', 'FAILED') NOT NULL DEFAULT 'SUCCESS',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_module_createdAt_idx`(`module`, `createdAt`),
    INDEX `audit_logs_operatorId_idx`(`operatorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_change_requests` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `storeId` INTEGER UNSIGNED NOT NULL,
    `merchantId` INTEGER UNSIGNED NOT NULL,
    `applicantId` INTEGER UNSIGNED NULL,
    `changes` JSON NOT NULL,
    `reason` VARCHAR(500) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewerId` INTEGER UNSIGNED NULL,
    `reviewRemark` VARCHAR(255) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `store_change_requests_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `merchants` ADD CONSTRAINT `merchants_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `merchants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stores` ADD CONSTRAINT `stores_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_users` ADD CONSTRAINT `admin_users_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_user_roles` ADD CONSTRAINT `admin_user_roles_adminUserId_fkey` FOREIGN KEY (`adminUserId`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_user_roles` ADD CONSTRAINT `admin_user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_authorizations` ADD CONSTRAINT `merchant_authorizations_mainMerchantId_fkey` FOREIGN KEY (`mainMerchantId`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_authorizations` ADD CONSTRAINT `merchant_authorizations_subMerchantId_fkey` FOREIGN KEY (`subMerchantId`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_authorization_templates` ADD CONSTRAINT `merchant_authorization_templates_authorizationId_fkey` FOREIGN KEY (`authorizationId`) REFERENCES `merchant_authorizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_authorization_templates` ADD CONSTRAINT `merchant_authorization_templates_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_templates` ADD CONSTRAINT `coupon_templates_creatorMerchantId_fkey` FOREIGN KEY (`creatorMerchantId`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_templates` ADD CONSTRAINT `coupon_templates_ownerMerchantId_fkey` FOREIGN KEY (`ownerMerchantId`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_template_stores` ADD CONSTRAINT `coupon_template_stores_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_template_stores` ADD CONSTRAINT `coupon_template_stores_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_codes` ADD CONSTRAINT `coupon_codes_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_codes` ADD CONSTRAINT `coupon_codes_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `coupon_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_instances` ADD CONSTRAINT `coupon_instances_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_instances` ADD CONSTRAINT `coupon_instances_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_accounts` ADD CONSTRAINT `point_accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_transactions` ADD CONSTRAINT `point_transactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_transactions` ADD CONSTRAINT `point_transactions_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `point_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_transactions` ADD CONSTRAINT `point_transactions_relatedCouponInstanceId_fkey` FOREIGN KEY (`relatedCouponInstanceId`) REFERENCES `coupon_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_couponInstanceId_fkey` FOREIGN KEY (`couponInstanceId`) REFERENCES `coupon_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redemption_records` ADD CONSTRAINT `redemption_records_couponInstanceId_fkey` FOREIGN KEY (`couponInstanceId`) REFERENCES `coupon_instances`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redemption_records` ADD CONSTRAINT `redemption_records_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redemption_records` ADD CONSTRAINT `redemption_records_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redemption_records` ADD CONSTRAINT `redemption_records_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_records` ADD CONSTRAINT `purchase_records_subMerchantId_fkey` FOREIGN KEY (`subMerchantId`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_records` ADD CONSTRAINT `purchase_records_mainMerchantId_fkey` FOREIGN KEY (`mainMerchantId`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_records` ADD CONSTRAINT `purchase_records_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `settlement_reports` ADD CONSTRAINT `settlement_reports_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_change_requests` ADD CONSTRAINT `store_change_requests_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

