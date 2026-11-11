-- AlterTable
ALTER TABLE `coupon_codes` ADD COLUMN `batchId` INTEGER UNSIGNED NULL;

-- CreateTable
CREATE TABLE `coupon_code_batches` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `batchNo` VARCHAR(32) NOT NULL,
    `templateId` INTEGER UNSIGNED NOT NULL,
    `quantity` INTEGER NOT NULL,
    `remark` VARCHAR(200) NULL,
    `operatorId` INTEGER UNSIGNED NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `coupon_code_batches_batchNo_key`(`batchNo`),
    INDEX `coupon_code_batches_templateId_idx`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `coupon_codes_batchId_idx` ON `coupon_codes`(`batchId`);

-- AddForeignKey
ALTER TABLE `coupon_code_batches` ADD CONSTRAINT `coupon_code_batches_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_codes` ADD CONSTRAINT `coupon_codes_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `coupon_code_batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
