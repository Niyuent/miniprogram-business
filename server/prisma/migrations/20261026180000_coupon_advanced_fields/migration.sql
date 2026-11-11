-- 券模板高级营销配置落库
ALTER TABLE `coupon_templates`
  ADD COLUMN `requireGreaterThanFace` BOOLEAN NOT NULL DEFAULT false AFTER `perUserLimit`,
  ADD COLUMN `applicableScope` JSON NULL AFTER `requireGreaterThanFace`;

-- rules 扩容：过渡期可能仍带 [ADV] 文本
ALTER TABLE `coupon_templates`
  MODIFY COLUMN `rules` TEXT NULL;
