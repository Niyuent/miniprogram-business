import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Permissions } from '../../common/decorators/roles.decorator';
import { MerchantScopeGuard, RequestScope } from '../../common/guards/merchant-scope.guard';
import { SubService } from './sub.service';

/**
 * 附属商家端接口（S1.1）
 *
 * 三层防护全部挂齐：
 *  1. JwtAuthGuard       —— 全站默认，确认「你是谁」
 *  2. MerchantScopeGuard —— 本挂载点，确认「这条数据是不是你的」，越权 403
 *  3. @Permissions       —— 确认「你有没有这个权限码」
 */
@ApiTags('sub')
@ApiBearerAuth()
@Controller('sub')
// 二次保险：模块级 APP_GUARD（sub.module.ts）已全局生效，
// 这里再显式挂一次，即使将来有人误删了模块注册也不会失去隔离。
@UseGuards(MerchantScopeGuard)
export class SubController {
  constructor(private readonly sub: SubService) {}

  @Get('stores')
  @Permissions('store:view')
  @ApiOperation({
    summary: '【SCOPED】查看本商家的门店列表',
    description:
      '数据范围由 JWT 强制锁定。显式传 merchantId 且不等于自身归属时返回 403 FORBIDDEN_SCOPE。',
  })
  listStores(
    @Req() req: Request & { scope: RequestScope },
    @Query('keyword') keyword?: string,
  ) {
    return this.sub.listStores(req.scope, keyword);
  }

  @Get('stores/:id')
  @Permissions('store:view')
  @ApiOperation({
    summary: '【SCOPED】查看门店详情',
    description: '不属于本商家时返回 404 RESOURCE_NOT_FOUND（不泄露该门店是否存在）。',
  })
  getStore(@Req() req: Request & { scope: RequestScope }, @Param('id', ParseIntPipe) id: number) {
    return this.sub.getStore(req.scope, id);
  }
}
