import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import {
  CreateRedemptionDto,
  QueryRedemptionsDto,
  ReverseRedemptionDto,
  VerifyCouponDto,
} from './dto/redemption.dto';
import { RedemptionService } from './redemption.service';

/**
 * 核销（S2.3）
 *
 * 两个动作分开是刻意的：
 * - `POST /redemptions/verify`：**只读**，用户输完券码后先看「这张券能不能用、为什么不能用」；
 * - `POST /redemptions`：确认后才落库。前端流程＝输码 → verify → 弹确认框 → 执行核销。
 *
 * 幂等靠两个机制叠加：券实例**条件更新**（`WHERE status='UNUSED'`）+ 核销记录
 * `@@unique([couponInstanceId, status])`。并发核销同一张券只会有一个 201，另一个 409，
 * 不会出现 500，也不会出现两条 SUCCESS。
 */
@ApiTags('redemptions')
@ApiBearerAuth()
@Controller('redemptions')
export class RedemptionController {
  constructor(private readonly redemptions: RedemptionService) {}

  @Post('verify')
  @Permissions('redemption:verify', 'redemption:create')
  // 只读操作不该返回 201 Created：201 意味着「创建了资源」，会误导调用方以为已经核销成功。
  // 成功 200（券可用）/ 失败 404·403·409（附 coupon 与逐项 checks）。
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '核销前置校验（只读，不写库）',
    description:
      '返回券信息 + redeemable + reasonCode + 逐项 checks。成功 HTTP 200；失败 404 CODE_NOT_FOUND / 403 STORE_NOT_OWNED·STORE_NOT_IN_SCOPE / 409 COUPON_ALREADY_USED·COUPON_FROZEN·COUPON_EXPIRED·TEMPLATE_NOT_AVAILABLE·CODE_NOT_ISSUED·COUPON_NOT_BELONG_TO_USER·THRESHOLD_NOT_MET·ORDER_ALREADY_HAS_COUPON（失败响应 data 里仍带 coupon 与 checks）。',
  })
  verify(@Body() dto: VerifyCouponDto, @CurrentUser() user: JwtPayload) {
    return this.redemptions.verify(dto, user);
  }

  @Post()
  @Permissions('redemption:create')
  @ApiOperation({
    summary: '执行核销',
    description:
      '事务内：① 订单绑定（409 ORDER_ALREADY_HAS_COUPON）→ ② 券实例条件更新 UNUSED→USED（409 COUPON_ALREADY_USED / COUPON_FROZEN / COUPON_EXPIRED）→ ③ 券码 REDEEMED + 模板 usedCount+1 → ④ 核销记录（唯一索引兜底）→ ⑤ 审计。',
  })
  redeem(
    @Body() dto: CreateRedemptionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.redemptions.redeem(dto, user, ip, ua);
  }

  @Get()
  @Permissions('redemption:view')
  @ApiOperation({
    summary: '核销记录列表（含按商家分组合计）',
    description:
      '数据隔离：平台全量；主体看自己门店 + 自己模板的核销；附属 / 店员只看本店。附属传别人的 merchantId → 403 FORBIDDEN_SCOPE。',
  })
  list(@Query() query: QueryRedemptionsDto, @CurrentUser() user: JwtPayload) {
    return this.redemptions.list(query, user);
  }

  @Post(':id/reverse')
  @Permissions('redemption:reverse')
  @ApiOperation({
    summary: '核销冲正（券退回未使用）',
    description:
      '记录保留为 REVERSED（不是删除），券实例回 UNUSED、券码回 ISSUED、模板 usedCount-1、订单解绑（同一订单随后可改用另一张券）。\n\n**权限收紧（S2.4）**：附属商家 / 店员只能冲正**本店 + 24 小时内**的记录；超时返回 403 `REVERSE_WINDOW_EXPIRED`，跨店返回 403 `STORE_NOT_OWNED`，这两种情况需要主体商家操作。\n\n**reason 必填（≥5 字符）**，同时写入 `redemption_records.reverseReason` 与审计日志。',
  })
  reverse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReverseRedemptionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.redemptions.reverse(id, dto, user, ip, ua);
  }
}
