-- AI-1：经营日报调用日志（Laya / DeepSeek）。手写迁移，避免 migrate dev 在历史 drift 上漏列。
CREATE TABLE `ai_call_logs` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(20) NOT NULL,
    `purpose` VARCHAR(40) NOT NULL,
    `merchantId` INTEGER UNSIGNED NULL,
    `ok` BOOLEAN NOT NULL,
    `latencyMs` INTEGER UNSIGNED NOT NULL,
    `error` VARCHAR(255) NULL,
    `requestJson` JSON NULL,
    `responseJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_call_logs_provider_createdAt_idx`(`provider`, `createdAt`),
    INDEX `ai_call_logs_merchantId_createdAt_idx`(`merchantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
