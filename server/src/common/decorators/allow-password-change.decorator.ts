import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_REQUIRED_KEY = 'allowPasswordChangeRequired';

/**
 * 标记：即使账号处于「首次登录必须改密」（`must_change_password=true`）状态也允许访问。
 *
 * 目前只有 `PUT /api/v1/auth/password` 需要打这个标记 ——
 * 否则账号会被自己的强制改密策略锁死：想改密却没有权限调改密接口。
 * 退出登录类操作由前端清 token，不需要服务端接口。
 */
export const AllowPasswordChangeRequired = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, true);
