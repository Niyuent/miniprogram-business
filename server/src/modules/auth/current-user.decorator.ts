import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { JwtPayload } from './jwt-payload';

/** @CurrentUser() 取整个载荷；@CurrentUser('merchantId') 取字段 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    return data ? req.user?.[data] : req.user;
  },
);
