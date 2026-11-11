-- DropForeignKey
ALTER TABLE `exchange_records` DROP FOREIGN KEY `exchange_records_instance_fk`;

-- DropForeignKey
ALTER TABLE `exchange_records` DROP FOREIGN KEY `exchange_records_template_fk`;

-- DropForeignKey
ALTER TABLE `exchange_records` DROP FOREIGN KEY `exchange_records_user_fk`;

-- AddForeignKey
ALTER TABLE `exchange_records` ADD CONSTRAINT `exchange_records_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exchange_records` ADD CONSTRAINT `exchange_records_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exchange_records` ADD CONSTRAINT `exchange_records_couponInstanceId_fkey` FOREIGN KEY (`couponInstanceId`) REFERENCES `coupon_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `exchange_records` RENAME INDEX `idx_exchange_template` TO `exchange_records_templateId_idx`;

-- RenameIndex
ALTER TABLE `exchange_records` RENAME INDEX `idx_exchange_user_created` TO `exchange_records_userId_createdAt_idx`;

-- RenameIndex
ALTER TABLE `exchange_records` RENAME INDEX `uniq_exchange_request` TO `exchange_records_userId_requestId_key`;

-- RenameIndex
ALTER TABLE `point_transactions` RENAME INDEX `uniq_point_txn_expire_source` TO `point_transactions_userId_sourceTransactionId_type_key`;
