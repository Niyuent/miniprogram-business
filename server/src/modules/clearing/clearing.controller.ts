import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { ClearingService } from './clearing.service';
import {
  GenerateClearingDto,
  QueryClearingBillsDto,
  SettleClearingBillDto,
} from './dto/clearing.dto';

/**
 * 商家互结清分（平台 / 商家共用）。
 *
 * 刻意不挂 `@Permissions()`：现有角色权限表里没有清分专用权限码，
 * 挂上会让商家端小程序一律 403。数据隔离全部在 service 内按 JwtPayload 完成
 *（与现有对账单口径一致）：
 *   - PLATFORM + 主体商家（MAIN）：看全量、可生成账期、可标记打款；
 *   - 附属商家 / 店员：只看与自己相关的账单，越权返回 404，不能改动打款状态；
 *   - 会员端 H5 令牌：没有绑定商家，直接拒绝。
 * 这与 me-authorization.controller 的做法一致。
 */
@ApiTags('merchant-clearing')
@ApiBearerAuth()
@Controller('merchant-clearing')
export class ClearingController {
  constructor(private readonly clearing: ClearingService) {}

  @Get('periods')
  @ApiOperation({ summary: '清分账期列表（商家只看与自己相关的）' })
  periods(@CurrentUser() user: JwtPayload) {
    return this.clearing.periods(user);
  }

  @Get('my')
  @ApiOperation({ summary: '商家端：我的应付 / 应收汇总' })
  my(@CurrentUser() user: JwtPayload) {
    return this.clearing.my(user);
  }

  @Get('bills')
  @ApiOperation({ summary: '按商家对轧差后的净额账单列表' })
  bills(@Query() query: QueryClearingBillsDto, @CurrentUser() user: JwtPayload) {
    return this.clearing.bills(query, user);
  }

  @Get('bills/:id')
  @ApiOperation({ summary: '清分账单详情（含构成净额的每一张券）' })
  billDetail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.clearing.billDetail(id, user);
  }

  @Post('generate')
  @ApiOperation({ summary: '生成 / 重算某自然月的清分账单（仅平台，幂等）' })
  generate(@Body() dto: GenerateClearingDto, @CurrentUser() user: JwtPayload) {
    return this.clearing.generate(dto, user);
  }

  /** 小程序 wx.request 不支持 PATCH，统一用 POST */
  @Post('bills/:id/settle')
  @ApiOperation({ summary: '标记已结算 / 撤销（仅平台）' })
  settle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SettleClearingBillDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clearing.settle(id, dto, user);
  }
}
