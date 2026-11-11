-- S2.4 冲正留痕: 原因 + 冲正时间
-- 用户口径中的 reverse_reason 在本项目统一为 camelCase 列名 reverseReason

-- AlterTable
ALTER TABLE `redemption_records` ADD COLUMN `reverseReason` VARCHAR(500) NULL,
    ADD COLUMN `reversedAt` DATETIME(3) NULL;
