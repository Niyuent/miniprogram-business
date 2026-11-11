import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserJwtAuthGuard } from '../auth/user-jwt-auth.guard';
import { UserJwtPayload } from '../auth/user-jwt-payload';
import { ExchangePointsDto, QueryExchangeRecordsDto, QueryPointTransactionsDto } from '../point/dto/point.dto';
import { H5Service } from './h5.service';
import { ExchangeAtShopDto } from './shop-exchange.dto';

/**
 * C 端 / H5 接口（S5.1）
 *
 * 鉴权：对全局 `JwtAuthGuard` 标记 `@Public()`（跳过后台鉴权），改由 `UserJwtAuthGuard` 强制 **C 端令牌**；
 * 后台令牌访问本前缀 → 403。所有数据以令牌 `userId` 为准，越权（伪造 userId）→ 403。
 */
@ApiTags('h5')
@ApiBearerAuth()
@Controller('h5')
@Public()
@UseGuards(UserJwtAuthGuard)
export class H5Controller {
  constructor(private readonly h5: H5Service) {}

  @Get('me')
  @ApiOperation({ summary: '当前 C 端用户资料' })
  me(@CurrentUser() user: UserJwtPayload) {
    return this.h5.me(user);
  }

  @Get('points/account')
  @ApiOperation({ summary: '我的积分账户（余额 / 批次 / 可用与临期）' })
  account(@CurrentUser() user: UserJwtPayload) {
    return this.h5.account(user);
  }

  @Get('points/transactions')
  @ApiOperation({ summary: '我的积分流水' })
  transactions(@CurrentUser() user: UserJwtPayload, @Query() query: QueryPointTransactionsDto) {
    return this.h5.transactions(user, query);
  }

  @Get('coupon-templates')
  @ApiOperation({
    summary: '可兑换券列表（按联盟过滤）',
    description: '必传 allianceId，只返回该联盟下已上架且可积分兑换的券；含 ownerType 供前端提示。',
  })
  couponTemplates(
    @Query('allianceId') allianceId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.h5.couponTemplates(Number(allianceId), Number(page) || 1, Number(pageSize) || 10);
  }

  @Get('points/exchange-options')
  @ApiOperation({
    summary: '可兑商品清单（按我的可用积分过滤，标注哪几家店的分能兑）',
    description:
      '规则：主体商家发的分可兑「主体商品 + 全部附属商品」；附属商家发的分「只能兑主体商品」。' +
      '每件商品附带 eligibleMerchants（哪几家店发的分能兑它）、payWith（MAIN=仅主体分 / BOTH=两种都行）与 affordable。',
  })
  exchangeOptions(
    @CurrentUser() user: UserJwtPayload,
    @Query('allianceId') allianceId?: string,
    @Query('merchantId') merchantId?: string,
  ) {
    return this.h5.exchangeOptions(
      user,
      allianceId ? Number(allianceId) : undefined,
      merchantId ? Number(merchantId) : undefined,
    );
  }

  @Get('my/coupons')
  @ApiOperation({ summary: '我的卡包（未使用 / 已使用 / 已过期，分页）' })
  myCoupons(
    @CurrentUser() user: UserJwtPayload,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('allianceId') allianceId?: string,
  ) {
    const tab = status === 'USED' || status === 'EXPIRED' ? status : 'UNUSED';
    return this.h5.myCoupons(
      user,
      tab,
      Number(page) || 1,
      Number(pageSize) || 10,
      allianceId ? Number(allianceId) : undefined,
    );
  }

  @Post('points/exchange')
  @ApiOperation({ summary: '积分兑换代金券（与 /h5/exchange 同一实现）' })
  exchangePoints(@CurrentUser() user: UserJwtPayload, @Body() dto: ExchangePointsDto) {
    return this.h5.exchange(user, dto);
  }

  @Get('templates')
  @ApiOperation({
    summary: '可兑换券列表（已上架 + 有库存 + 设了兑换积分；可按 allianceId 过滤）',
  })
  templates(@CurrentUser() user: UserJwtPayload, @Query('allianceId') allianceId?: string) {
    return this.h5.templates(allianceId ? Number(allianceId) : undefined, user.userId);
  }

  @Get('exchange-records')
  @ApiOperation({ summary: '我的兑换记录' })
  exchangeRecords(@CurrentUser() user: UserJwtPayload, @Query() query: QueryExchangeRecordsDto) {
    return this.h5.exchangeRecords(user, query);
  }

  @Post('exchange')
  @ApiOperation({ summary: '积分兑换代金券（userId 取自令牌；伪造 userId → 403）' })
  exchange(@CurrentUser() user: UserJwtPayload, @Body() dto: ExchangePointsDto) {
    return this.h5.exchange(user, dto);
  }

  // ── 「逛商家」：兑换区藏进每一家商家里，会员端不再出现联盟概念 ──

  @Get('merchants/nearby')
  @ApiOperation({
    summary: '附近商家（按手机定位由近到远）',
    description: '只返回已加入联盟的商家；带我在这家店可用积分。未授权定位或无坐标时按可用积分排序。',
  })
  nearbyMerchants(
    @CurrentUser() user: UserJwtPayload,
    @Query('lng') lng?: string,
    @Query('lat') lat?: string,
  ) {
    return this.h5.nearbyMerchants(
      user,
      lng === undefined || lng === '' ? undefined : Number(lng),
      lat === undefined || lat === '' ? undefined : Number(lat),
    );
  }

  @Get('merchants/:merchantId/exchange-templates')
  @ApiOperation({
    summary: '某家商家的积分兑换区',
    description: '本店可用券（本店发的 / 适用门店含本店的 / 全店通用的），不按联盟过滤；带在这家店可用积分。',
  })
  shopExchangeTemplates(
    @CurrentUser() user: UserJwtPayload,
    @Param('merchantId') merchantId: string,
  ) {
    return this.h5.shopExchangeTemplates(user, Number(merchantId));
  }

  @Post('merchants/:merchantId/exchange')
  @ApiOperation({
    summary: '在这家商家用本店攒的积分兑换券',
    description: 'userId 取自令牌；扣分账户由路径里的商家决定，只扣该商家发的积分；不校验券所属联盟。',
  })
  exchangeAtShop(
    @CurrentUser() user: UserJwtPayload,
    @Param('merchantId') merchantId: string,
    @Body() dto: ExchangeAtShopDto,
  ) {
    return this.h5.exchangeAtShop(user, Number(merchantId), dto);
  }
}
