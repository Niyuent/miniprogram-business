import { Body, Controller, Get, Headers, Ip, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { CreateStoreChangeDto, QueryStoreChangeDto, ReviewStoreChangeDto } from './dto/store-change.dto';
import { StoreChangeService } from './store-change.service';

/**
 * 门店变更申请（S5.3）
 *
 * 权限：
 *  - `store:change:submit` —— 附属提交 / 查看本店 / 作废（数据范围由 JWT 锁定，越权 403 STORE_NOT_OWNED）
 *  - `store:change:review` —— 主体 / 平台审核（列表 / 详情 / 通过 / 驳回）
 *
 * ⚠️ 本控制器挂在 `/stores` 前缀（非 `/sub`），MerchantScopeGuard 不生效，
 *    因此数据隔离**一律在 StoreChangeService.scope() 内实现**，不信任前端传参。
 */
@ApiTags('stores')
@ApiBearerAuth()
@Controller('stores')
export class StoreChangeController {
  constructor(private readonly service: StoreChangeService) {}

  // ---------------------------------------------------------------- 主体：审核

  @Get('change-requests')
  @Permissions('store:change:review')
  @ApiOperation({ summary: '门店变更申请列表（主体/平台审核用）' })
  listForReview(@Query() query: QueryStoreChangeDto, @CurrentUser() user: JwtPayload) {
    return this.service.listForReview(query, user);
  }

  @Get('change-requests/:id')
  @Permissions('store:change:review')
  @ApiOperation({ summary: '门店变更申请详情（含变更前后对比）' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.detail(id, user);
  }

  @Post('change-requests/:id/review')
  @Permissions('store:change:review')
  @ApiOperation({ summary: '审核门店变更申请（通过 / 驳回；驳回必填 remark）' })
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewStoreChangeDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.service.review(id, dto, user, ip, ua);
  }

  // ---------------------------------------------------------------- 附属：提交 / 查看 / 作废

  @Post('change-requests/:id/cancel')
  @Permissions('store:change:submit')
  @ApiOperation({ summary: '作废本店的待审核申请（申请不可修改，只能作废后重新提交）' })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.service.cancel(id, user, ip, ua);
  }

  @Post(':id/change-requests')
  @Permissions('store:change:submit')
  @ApiOperation({
    summary: '提交门店变更申请（仅限本商家/本门店；白名单字段）',
    description:
      '可变更：名称/联系人/电话/省市区/地址/经纬度/营业时间/logo。禁止变更：门店编码 code、所属商家 merchantId、门店状态 status（夹带即 400）。',
  })
  submit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStoreChangeDto,
    @Req() req: Request,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.service.submit(id, dto, user, req.body as Record<string, unknown>, ip, ua);
  }

  @Get(':id/change-requests')
  @Permissions('store:change:submit')
  @ApiOperation({ summary: '查看本门店的变更申请（含状态）' })
  listForStore(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.listForStore(id, user);
  }
}
