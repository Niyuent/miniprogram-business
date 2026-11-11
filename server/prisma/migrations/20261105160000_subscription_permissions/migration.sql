-- 计费权限：附属档位与主体会员
-- 追加在权限表末尾，既有权限主键不变（seed 里也是追加，两处保持一致）。
-- 使用 NOT EXISTS 保证可重复执行：seed 重灌过也不会插重。

INSERT INTO `permissions` (`code`, `name`, `group`)
SELECT 'subscription:view', '查看计费与档位', 'subscription' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'subscription:view');

INSERT INTO `permissions` (`code`, `name`, `group`)
SELECT 'subscription:submit', '提交充值申请', 'subscription' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'subscription:submit');

INSERT INTO `permissions` (`code`, `name`, `group`)
SELECT 'subscription:confirm', '确认收款', 'subscription' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'subscription:confirm');

INSERT INTO `permissions` (`code`, `name`, `group`)
SELECT 'subscription:cancel', '驳回充值申请', 'subscription' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'subscription:cancel');

-- 平台 / 主体：四项全给（确认收款只应是他们）
INSERT INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`code` IN ('subscription:view', 'subscription:submit', 'subscription:confirm', 'subscription:cancel')
WHERE r.`code` IN ('PLATFORM_ADMIN', 'MAIN_ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- 附属：只能看与提交，不能自己确认收款
INSERT INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`code` IN ('subscription:view', 'subscription:submit')
WHERE r.`code` IN ('SUB_ADMIN', 'SUB_ADMIN_BASIC')
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp WHERE rp.roleId = r.`id` AND rp.permissionId = p.`id`
  );
