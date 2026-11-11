-- 核销幂等键：redemption_records.requestId（可空）+ (userId, requestId) 唯一索引
-- 前端一次确认生成一个 requestId；同键重试返回首次结果（200 + idempotent:true），不再报 409
ALTER TABLE `redemption_records`
  ADD COLUMN `requestId` VARCHAR(64) NULL,
  ADD UNIQUE INDEX `redemption_records_userId_requestId_key`(`userId`, `requestId`);
