import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { QueryPointTransactionsDto } from './dto/point.dto';
import { PointService } from './point.service';

/**
 * 积分流水（S3.1）
 *
 * 五种类型：`EARN`（消费获得，正）/ `SPEND`（兑换消耗，负）/ `EXPIRE`（过期清零，负）/
 * `REFUND`（异常订单回退，正，且回到原批次保留原有效期）/ `ADJUST`（人工调整，带符号）。
 */
@ApiTags('point-transactions')
@ApiBearerAuth()
@Controller('point-transactions')
export class PointTransactionController {
  constructor(private readonly points: PointService) {}

  @Get()
  @Permissions('point:view')
  @ApiOperation({
    summary: '积分流水列表（类型 / 用户 / 商家 / 门店 / 时间筛选）',
    description: '每一条都带 `remainingAmount`（该批次还能花多少）与 `balanceAfter`（变动后余额），可对账逐步回溯。',
  })
  list(@Query() query: QueryPointTransactionsDto, @CurrentUser() user: JwtPayload) {
    return this.points.listTransactions(query, user);
  }
}
