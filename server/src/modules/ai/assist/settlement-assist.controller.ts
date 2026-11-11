import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtPayload } from '../../auth/jwt-payload';
import { SettlementAssistService } from './settlement-assist.service';

/**
 * AI 结算助手（商家端）。
 *
 * 只读：不改账单状态、不触发结算。确认/异议仍走 /settlements/:id/confirm，
 * 由商家在界面上明确点击，避免「AI 替我确认了账」这种不可接受的越权。
 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai/assist/settlement')
export class SettlementAssistController {
  constructor(private readonly assist: SettlementAssistService) {}

  @Get('overview')
  @Permissions('settlement:view')
  @ApiOperation({
    summary: '结算总览：待确认/已确认/异议 + 近 6 期趋势 + AI 洞察',
    description:
      '按登录账号的结算可见范围聚合（主体看全部、附属只看自己）。所有数字来自数据库聚合，模型只做定性解读且被禁止输出数字。',
  })
  overview(@CurrentUser() user: JwtPayload) {
    return this.assist.overview(user);
  }

  @Get(':id/insight')
  @Permissions('settlement:view')
  @ApiOperation({
    summary: '单张账单核查：门店/时段分布 + 异常检查 + 可确认结论',
    description:
      '检查重复券码、同一会员多次核销、深夜核销占比、面值异常、门店集中度。' +
      '存在严重项时给出不可直接确认的结论，并附异议理由草稿。只读，不改账单状态。',
  })
  insight(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.assist.billInsight(id, user);
  }
}
