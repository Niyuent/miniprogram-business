-- AI 对话审计字段 + 权限码 ai:chat
ALTER TABLE `ai_call_logs`
  ADD COLUMN `sessionId` VARCHAR(64) NULL,
  ADD COLUMN `intent` VARCHAR(40) NULL,
  ADD COLUMN `toolCalls` JSON NULL,
  ADD COLUMN `tokenIn` INTEGER UNSIGNED NULL,
  ADD COLUMN `tokenOut` INTEGER UNSIGNED NULL;

CREATE INDEX `ai_call_logs_sessionId_createdAt_idx` ON `ai_call_logs`(`sessionId`, `createdAt`);

INSERT INTO `permissions` (`code`, `name`, `group`, `createdAt`)
SELECT 'ai:chat', '经营问数对话', 'ai', NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `code` = 'ai:chat');

INSERT INTO `role_permissions` (`roleId`, `permissionId`)
SELECT r.id, p.id
FROM `roles` r
CROSS JOIN `permissions` p
WHERE p.code = 'ai:chat'
  AND r.code IN ('PLATFORM_ADMIN', 'MAIN_ADMIN', 'SUB_ADMIN', 'SUB_ADMIN_BASIC')
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id
  );
