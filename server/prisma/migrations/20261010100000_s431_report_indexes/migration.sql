-- S4.3.1 报表中心：为聚合热路径补充索引（隔离 + 时间范围）
-- 1) orders：ordersSummary 按 consumeTime 范围聚合（原索引第三列是 createdAt，不匹配）
CREATE INDEX `orders_merchantId_storeId_consumeTime_idx` ON `orders` (`merchantId`, `storeId`, `consumeTime`);
--    平台/主体场景无 merchantId 前缀，需单列 consumeTime 范围索引
CREATE INDEX `orders_consumeTime_idx` ON `orders` (`consumeTime`);

-- 2) coupon_instances：couponSummary 按 issuerMerchantId 过滤 + obtainedAt 范围
CREATE INDEX `coupon_instances_issuerMerchantId_obtainedAt_idx` ON `coupon_instances` (`issuerMerchantId`, `obtainedAt`);
CREATE INDEX `coupon_instances_obtainedAt_idx` ON `coupon_instances` (`obtainedAt`);

-- 3) point_transactions：pointsSummary 按 merchantId/storeId 过滤 + createdAt 范围
CREATE INDEX `point_transactions_merchantId_storeId_createdAt_idx` ON `point_transactions` (`merchantId`, `storeId`, `createdAt`);
CREATE INDEX `point_transactions_createdAt_idx` ON `point_transactions` (`createdAt`);
