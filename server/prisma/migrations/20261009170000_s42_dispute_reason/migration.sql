-- S4.2 收口：settlement_reports 增加 disputeReason（异议原因回显）
--
-- 为什么手写：`prisma migrate dev` 对本库判定为 "Already in sync"，未自动生成该 ADD COLUMN。
-- 原因是本库历史上部分索引 / 外键由 server/prisma/sql/*.sql 手工脚本创建，
-- 命名与 Prisma 默认约定不一致（drift），导致差异计算失真（它只生成了一批 rename 语句）。
-- 列类型与 schema.prisma 保持一致：`disputeReason String? @db.VarChar(500)`。
ALTER TABLE `settlement_reports` ADD COLUMN `disputeReason` VARCHAR(500) NULL;
