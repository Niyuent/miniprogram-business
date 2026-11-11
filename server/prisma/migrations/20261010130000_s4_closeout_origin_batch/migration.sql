-- S4 收口修复：SPEND 不再复用 sourceTransactionId（唯一键 (userId, sourceTransactionId, type) 仅约束 EXPIRE），
-- 新增 originBatchId 承载「SPEND/REFUND 关联的原 EARN 批次」，避免同一用户从同一批次二次扣分撞唯一键。
ALTER TABLE `point_transactions` ADD COLUMN `originBatchId` INTEGER UNSIGNED NULL;

-- 历史数据回填：把已有 SPEND 的 sourceTransactionId 迁移到 originBatchId，并置 NULL 以释放唯一键。
UPDATE `point_transactions`
SET `originBatchId` = `sourceTransactionId`, `sourceTransactionId` = NULL
WHERE `type` = 'SPEND' AND `sourceTransactionId` IS NOT NULL;
