-- S3.3 积分过期清零：在 point_transactions 上补 sourceTransactionId（EXPIRE 流水指回原 EARN 批次）
-- 并用 (userId, sourceTransactionId, type) 唯一索引做幂等键（同一批次只能有一条 EXPIRE）。

ALTER TABLE point_transactions
  ADD COLUMN sourceTransactionId INT UNSIGNED NULL
  AFTER relatedCouponInstanceId;

ALTER TABLE point_transactions
  ADD CONSTRAINT uniq_point_txn_expire_source UNIQUE (userId, sourceTransactionId, type);
