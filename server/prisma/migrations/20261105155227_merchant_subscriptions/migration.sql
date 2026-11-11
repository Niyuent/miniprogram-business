-- CreateTable
CREATE TABLE `merchant_subscriptions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `merchantId` INTEGER UNSIGNED NOT NULL,
    `planType` ENUM('MAIN_MEMBER', 'SUB_TIER') NOT NULL,
    `tier` ENUM('PRIMARY', 'ADVANCED') NULL,
    `period` ENUM('MONTH', 'QUARTER', 'HALF_YEAR', 'YEAR') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `orderNo` VARCHAR(32) NOT NULL,
    `payChannel` VARCHAR(16) NOT NULL DEFAULT 'OFFLINE',
    `payRemark` VARCHAR(255) NULL,
    `confirmedById` INTEGER UNSIGNED NULL,
    `confirmedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `remark` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_subscriptions_orderNo_key`(`orderNo`),
    INDEX `merchant_subscriptions_merchantId_planType_status_idx`(`merchantId`, `planType`, `status`),
    INDEX `merchant_subscriptions_status_endsAt_idx`(`status`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `merchant_subscriptions` ADD CONSTRAINT `merchant_subscriptions_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
