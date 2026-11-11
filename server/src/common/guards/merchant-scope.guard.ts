import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { BizException, ReasonCode } from '../exceptions/biz.exception';
import { JwtPayload } from '../../modules/auth/jwt-payload';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** 注入到 req.scope 的数据边界，Service 层必须以此为准 */
export interface RequestScope {
  /** 主体/附属商家 id；平台管理员未指定则为 null（表示「不限」） */
  merchantId: number | null;
  /** 门店 id；仅 STORE 类型账号有值 */
  storeId: number | null;
  userType: 'PLATFORM' | 'MERCHANT' | 'STORE';
  userId: number;
  /** 是否为平台管理员（放行全平台） */
  isPlatform: boolean;
}

type ScopedRequest = Request & {
  user?: JwtPayload;
  scope?: RequestScope;
};

/**
 * 数据隔离守卫（H6）
 *
 * 注册方式：**模块级全局守卫**（`sub.module.ts` 中 `APP_GUARD`）。
 * 这样以后新增 `/sub/**` 接口，即使忘记写 `@UseGuards(MerchantScopeGuard)` 也不会裸奔。
 * Controller 上仍保留显式 `@UseGuards(MerchantScopeGuard)` 作为二次保险（会执行两次，逻辑幂等）。
 *
 * 作用范围判定（三选一放行，其余才校验）：
 *  1. 不是 `/sub/**` 路由 → 直接放行（平台侧接口不受本守卫约束）
 *  2. 打了 `@Public()` → 放行
 *  3. 还没有登录身份 → 放行，交给 JwtAuthGuard 去 401
 *     （模块级守卫的执行顺序取决于模块注册顺序，本守卫可能先于 JwtAuthGuard；
 *       此时若抢先 403 会掩盖「未登录」这个真实原因）
 *
 * 命中后做三件事：
 *  1. **校验**：请求里显式传入的 `merchantId` / `storeId` 若不属于当前账号 → 403。
 *     这是「越权读写别人数据」的最后一道闸门。
 *  2. **覆盖**：把 query / body 里的 `merchantId` 强行改写成 JWT 中的值，
 *     让 Service 层即使偷懒不过滤也拿不到别人的数据（防呆优于文档约束）。
 *  3. **下发**：把 `RequestScope` 挂到 `req.scope`，Service 用它拼 WHERE 条件。
 *     非平台账号解析不出归属商家时 → 403 `SCOPE_NOT_READY`，绝不退化成「不限制」。
 *
 * 放行规则：
 *  - `PLATFORM`：不限商家，可带 merchantId 精确查看某一家。
 *  - `MERCHANT`：强制等于自身 merchantId。
 *  - `STORE`：强制等于自身 merchantId 且 storeId 等于自身门店。
 *
 * @see scopedWhere() Service 层用它构造 Prisma 查询条件
 */
@Injectable()
export class MerchantScopeGuard implements CanActivate {
  private readonly logger = new Logger('MerchantScope');

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ScopedRequest>();

    if (!this.isSubRoute(context, req)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const user = req.user;
    if (!user) {
      // 认证不是本守卫的职责，放行让 JwtAuthGuard 给出 401
      this.logger.debug(`/sub 路由尚未解析出身份，交给 JwtAuthGuard：${req.originalUrl ?? req.url}`);
      return true;
    }

    const requestedMerchantId = pickNumeric(req, 'merchantId');
    const requestedStoreId = pickNumeric(req, 'storeId');

    const isPlatform = user.userType === 'PLATFORM';
    const ownMerchantId = user.merchantId ?? null;

    // 1) 越权：显式请求了不属于自己的商家
    if (!isPlatform && requestedMerchantId !== undefined && requestedMerchantId !== ownMerchantId) {
      this.logger.warn(
        `越权拦截 user=${user.sub}(${user.username}) 请求 merchantId=${requestedMerchantId}，实际归属=${ownMerchantId}`,
      );
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权访问该商家的数据');
    }

    // 2) 越权：店员只能看自己门店
    const ownStoreId = user.storeId ?? null;
    if (user.userType === 'STORE' && requestedStoreId !== undefined && requestedStoreId !== ownStoreId) {
      this.logger.warn(
        `越权拦截 user=${user.sub}(${user.username}) 请求 storeId=${requestedStoreId}，实际归属=${ownStoreId}`,
      );
      throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, '无权访问该门店的数据');
    }

    // 3) 覆盖：平台管理员可指定商家，其余一律锁定为自身归属
    const effectiveMerchantId = isPlatform ? (requestedMerchantId ?? null) : ownMerchantId;
    const effectiveStoreId =
      user.userType === 'STORE' ? ownStoreId : (requestedStoreId ?? null);

    // 4) 归属解析不出来就拒绝，绝不退化成「不限制」
    if (!isPlatform && effectiveMerchantId === null) {
      throw BizException.forbidden(
        ReasonCode.SCOPE_NOT_READY,
        '无法确定数据归属范围，拒绝执行查询',
      );
    }

    if (!isPlatform && effectiveMerchantId !== null) {
      assignNumeric(req, 'merchantId', effectiveMerchantId);
    }
    if (requestedStoreId !== undefined || user.userType === 'STORE') {
      if (effectiveStoreId !== null) {
        assignNumeric(req, 'storeId', effectiveStoreId);
      }
    }

    req.scope = {
      merchantId: effectiveMerchantId,
      storeId: effectiveStoreId,
      userType: user.userType,
      userId: user.sub,
      isPlatform,
    };

    return true;
  }

  /**
   * 是否属于 `/sub/**` 路由。
   *
   * 优先读 Controller 的 `@Controller('sub')` 元数据，而不是解析 URL ——
   * 后者带全局前缀 `api/v1`，且将来改前缀就会失效。
   */
  private isSubRoute(context: ExecutionContext, req: ScopedRequest): boolean {
    const controllerPath =
      this.reflector.get<string>(PATH_METADATA, context.getClass()) ?? '';
    if (controllerPath) {
      return controllerPath === 'sub' || controllerPath.startsWith('sub/');
    }
    // 兜底：Controller 元数据取不到时按 URL 段判断
    const url = (req.originalUrl ?? req.url ?? '').split('?')[0];
    return url.split('/').includes('sub');
  }
}

/** 从 query → body → params 依次取值（首个非空的数字为准） */
function pickNumeric(req: ScopedRequest, key: string): number | undefined {
  const raw =
    (req.query as Record<string, unknown> | undefined)?.[key] ??
    (req.body as Record<string, unknown> | undefined)?.[key] ??
    (req.params as Record<string, unknown> | undefined)?.[key];

  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

/** 把有效范围写回 query / body，让 Service 层无从偷懒 */
function assignNumeric(req: ScopedRequest, key: string, value: number): void {
  if (req.query) (req.query as Record<string, unknown>)[key] = String(value);
  if (req.body && typeof req.body === 'object') {
    (req.body as Record<string, unknown>)[key] = value;
  }
}

/**
 * Service 层用它构造 Prisma 的 WHERE 片段。
 *
 * 平台管理员未指定商家时返回 `{}`（不限），
 * 其余情况**必定**带上 merchantId —— 禁止出现「不带 merchantId 的全表查询」。
 */
export function scopedWhere(
  scope: Pick<RequestScope, 'merchantId' | 'storeId' | 'isPlatform'>,
): { merchantId?: number; storeId?: number } {
  if (scope.isPlatform && scope.merchantId === null) return {};
  const where: { merchantId?: number; storeId?: number } = {};
  if (scope.merchantId !== null) where.merchantId = scope.merchantId;
  if (scope.storeId !== null) where.storeId = scope.storeId;
  return where;
}

/** 供需要原生 UnauthorizedException 的地方复用 */
export { UnauthorizedException };
