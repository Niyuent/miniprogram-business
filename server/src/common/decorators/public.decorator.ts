import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'shangmeng:isPublic';

/**
 * 标记该接口无需 JWT 即可访问。
 *
 * ⚠️ 必须配 `JwtAuthGuard` 作为**全局守卫**才有意义（`app.module.ts` 中 `APP_GUARD` 注册）。
 * 全站默认「拒绝未声明的」，只有显式打 `@Public()` 的才放行，
 * 避免新加接口忘记挂守卫导致裸奔（越权最常见来源）。
 *
 * 现有放行者：`health/check`、`auth/login`、`auth/dev-token`(临时)、
 * `sse/publish`、`sse/stats`（后两者改由 `ApiTokenGuard` 把关）。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
