import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { QueryPointAccountsDto } from './dto/point.dto';
import { PointService } from './point.service';

/**
 * 积分账户（S3.1）
 *
 * 可见范围由 JWT 推导：平台全量；主体商家看「自己 + 直属附属」体系内有积分流水的用户；
 * 附属 / 店员只看在自己商家 / 门店产生过积分的用户。越权 → 403 `FORBIDDEN_SCOPE`。
 */
@ApiTags('point-accounts')
@ApiBearerAuth()
@Controller('point-accounts')
export class PointAccountController {
  constructor(private readonly points: PointService) {}

  @Get()
  @Permissions('point:view')
  @ApiOperation({
    summary: '积分账户列表（用户昵称 / 手机号 / 余额筛选，含临期积分）',
    description: '列表带 `expiringSoon` 字段（30 天内过期的可用积分），便于运营筛选「该提醒的用户」。',
  })
  list(@Query() query: QueryPointAccountsDto, @CurrentUser() user: JwtPayload) {
    return this.points.listAccounts(query, user);
  }

  @Get(':userId')
  @Permissions('point:view')
  @ApiOperation({
    summary: '积分账户详情（余额 + 批次明细 + 临期汇总）',
    description:
      '`summary.available` 是**真正能花的**（未过期批次剩余之和），与 `balance` 的差额即「已过期待清理」的批次——S3.2「余额够但兑换失败」的原因就在这里。',
  })
  detail(@Param('userId', ParseIntPipe) userId: number, @CurrentUser() user: JwtPayload) {
    return this.points.accountDetail(userId, user);
  }
}
