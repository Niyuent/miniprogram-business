import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { MerchantAllianceService } from './merchant-alliance.service';

/**
 * 商家端「我的联盟」。
 *
 * 不挂 @Permissions()：权限由 service 按「是否已加入该联盟 + 在该联盟是否可管理」
 * 判定，避免角色码缺失导致商家一律 403（与清分模块一致）。
 * 会员令牌没有 merchantId，会被 service 直接拒绝。
 */
@ApiTags('merchant-alliances')
@ApiBearerAuth()
@Controller('merchant-alliances')
export class MerchantAllianceController {
  constructor(private readonly service: MerchantAllianceService) {}

  @Get('mine')
  @ApiOperation({ summary: '我加入的联盟列表（含成员数、门店数、本店在该联盟的经营概要）' })
  mine(@CurrentUser() user: JwtPayload) {
    return this.service.mine(user);
  }

  @Get(':allianceId')
  @ApiOperation({ summary: '联盟详情：成员商家与门店、经营数字、清分与对账' })
  detail(
    @Param('allianceId', ParseIntPipe) allianceId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.detail(allianceId, user);
  }
}
