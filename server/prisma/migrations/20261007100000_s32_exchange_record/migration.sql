-- S3.2 积分兑换记录表
--
-- 关键约束：`uniq_exchange_request (userId, requestId)` —— 「用户快速双击兑换」的幂等键。
-- 应用层先查再插只能减少冲突概率，真正兜底要靠数据库唯一约束：
-- 并发重复提交时后到的请求撞 1062（Prisma P2002），服务层把它翻译成「返回上次结果（200 + idempotent=true）」。

CREATE TABLE `exchange_records` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `userId` int unsigned NOT NULL,
  `templateId` int unsigned NOT NULL,
  `couponInstanceId` int unsigned DEFAULT NULL,
  `pointsCost` int NOT NULL DEFAULT 0,
  `requestId` varchar(64) NOT NULL,
  `channel` varchar(191) NOT NULL DEFAULT 'H5',
  `merchantId` int unsigned DEFAULT NULL,
  `operatorId` int unsigned DEFAULT NULL,
  `remark` varchar(255) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_exchange_request` (`userId`, `requestId`),
  KEY `idx_exchange_user_created` (`userId`, `createdAt`),
  KEY `idx_exchange_template` (`templateId`),
  KEY `idx_exchange_instance` (`couponInstanceId`),
  CONSTRAINT `exchange_records_user_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`),
  CONSTRAINT `exchange_records_template_fk` FOREIGN KEY (`templateId`) REFERENCES `coupon_templates` (`id`),
  CONSTRAINT `exchange_records_instance_fk` FOREIGN KEY (`couponInstanceId`) REFERENCES `coupon_instances` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
