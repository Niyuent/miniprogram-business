-- 邀请归因：users.inviterId / merchants.inviterId（均可空、自引用外键）
-- C 端：会员分享 U{userId} → 新用户首触登录时记录；入驻：主体分享 SM{merchantId} → 附属入驻申请记录
ALTER TABLE `users`
  ADD COLUMN `inviterId` INTEGER UNSIGNED NULL,
  ADD INDEX `users_inviterId_idx`(`inviterId`),
  ADD CONSTRAINT `users_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `merchants`
  ADD COLUMN `inviterId` INTEGER UNSIGNED NULL,
  ADD INDEX `merchants_inviterId_idx`(`inviterId`),
  ADD CONSTRAINT `merchants_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `merchants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
