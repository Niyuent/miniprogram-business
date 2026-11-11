-- 商家互结（清分）：账期 → 商家对净额账单 → 每笔已核销券明细
-- 与 settlement_reports（平台→商家对账单）完全独立，互不干扰。

-- CreateTable
CREATE TABLE `merchant_clearing_periods` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `periodKey` VARCHAR(7) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `billCount` INTEGER NOT NULL DEFAULT 0,
    `itemCount` INTEGER NOT NULL DEFAULT 0,
    `netTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` ENUM('GENERATED', 'CLOSED') NOT NULL DEFAULT 'GENERATED',
    `generatedBy` INTEGER UNSIGNED NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recalculatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_clearing_periods_periodKey_key`(`periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_clearing_bills` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `periodId` INTEGER UNSIGNED NOT NULL,
    `payerMerchantId` INTEGER UNSIGNED NOT NULL,
    `receiverMerchantId` INTEGER UNSIGNED NOT NULL,
    `grossForward` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `grossReverse` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `forwardCount` INTEGER NOT NULL DEFAULT 0,
    `reverseCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('UNSETTLED', 'SETTLED') NOT NULL DEFAULT 'UNSETTLED',
    `settledAt` DATETIME(3) NULL,
    `settledBy` INTEGER UNSIGNED NULL,
    `settleRemark` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mc_bills_period_payer_receiver_key`(`periodId`, `payerMerchantId`, `receiverMerchantId`),
    INDEX `merchant_clearing_bills_payerMerchantId_status_idx`(`payerMerchantId`, `status`),
    INDEX `merchant_clearing_bills_receiverMerchantId_status_idx`(`receiverMerchantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_clearing_items` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `billId` INTEGER UNSIGNED NOT NULL,
    `redemptionId` INTEGER UNSIGNED NOT NULL,
    `exchangeRecordId` INTEGER UNSIGNED NULL,
    `couponInstanceId` INTEGER UNSIGNED NOT NULL,
    `templateId` INTEGER UNSIGNED NOT NULL,
    `payerMerchantId` INTEGER UNSIGNED NOT NULL,
    `receiverMerchantId` INTEGER UNSIGNED NOT NULL,
    `redeemMerchantId` INTEGER UNSIGNED NULL,
    `storeId` INTEGER UNSIGNED NULL,
    `userId` INTEGER UNSIGNED NOT NULL,
    `code` VARCHAR(32) NULL,
    `templateName` VARCHAR(128) NULL,
    `faceValue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `pointsCost` INTEGER NOT NULL DEFAULT 0,
    `redeemedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `merchant_clearing_items_redemptionId_key`(`redemptionId`),
    INDEX `merchant_clearing_items_billId_idx`(`billId`),
    INDEX `merchant_clearing_items_redeemedAt_idx`(`redeemedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `merchant_clearing_bills`
    ADD CONSTRAINT `merchant_clearing_bills_periodId_fkey`
    FOREIGN KEY (`periodId`) REFERENCES `merchant_clearing_periods`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_clearing_items`
    ADD CONSTRAINT `merchant_clearing_items_billId_fkey`
    FOREIGN KEY (`billId`) REFERENCES `merchant_clearing_bills`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
