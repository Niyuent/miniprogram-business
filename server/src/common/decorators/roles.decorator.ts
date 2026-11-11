import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'shangmeng:roles';
export const PERMISSIONS_KEY = 'shangmeng:permissions';

/**
 * 角色白名单：命中任意一个角色即放行。
 * 取值来自 `roles.code`（如 `PLATFORM_ADMIN` / `MAIN_ADMIN` / `SUB_ADMIN` / `STORE_CLERK`）。
 *
 * @example
 * @Roles('PLATFORM_ADMIN')
 * @Get('applications')
 * listApplications() {}
 */
export const Roles = (...codes: string[]) => SetMetadata(ROLES_KEY, codes);

/**
 * 权限码白名单：命中任意一个权限码即放行。
 * 取值来自 `permissions.code`（如 `merchant:audit` / `coupon:create`）。
 *
 * 说明（对齐 docs/04 第 9 条结论）：S1 做「角色 → 权限码字符串数组」的简化映射，
 * 登录时一次性灌进 JWT，本装饰器只做纯内存比对，不查库。
 *
 * @example
 * @Permissions('merchant:audit')
 * @Post(':id/approve')
 * approve() {}
 */
export const Permissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);
